-- Preserve requested snapshots while allowing owner-managed final confirmation.

alter table public.orders
  add column if not exists confirmed_subtotal numeric not null default 0,
  add column if not exists confirmed_total numeric not null default 0;

alter table public.order_items
  add column if not exists confirmed_quantity integer,
  add column if not exists confirmed_unit_price numeric,
  add column if not exists confirmed_line_total numeric;

update public.order_items
set confirmed_quantity = quantity,
    confirmed_unit_price = unit_price,
    confirmed_line_total = line_total
where confirmed_quantity is null or confirmed_unit_price is null or confirmed_line_total is null;

alter table public.order_items
  alter column confirmed_quantity set not null,
  alter column confirmed_unit_price set not null,
  alter column confirmed_line_total set not null,
  drop constraint if exists order_items_confirmed_quantity_check,
  add constraint order_items_confirmed_quantity_check check (confirmed_quantity >= 1),
  drop constraint if exists order_items_confirmed_price_check,
  add constraint order_items_confirmed_price_check check (confirmed_unit_price >= 0 and confirmed_line_total >= 0);

create or replace function public.prepare_order_item_confirmation()
returns trigger language plpgsql set search_path = public as $$
begin
  new.confirmed_quantity := coalesce(new.confirmed_quantity, new.quantity);
  new.confirmed_unit_price := coalesce(new.confirmed_unit_price, new.unit_price);
  new.confirmed_line_total := new.confirmed_quantity * new.confirmed_unit_price;
  return new;
end;
$$;

drop trigger if exists prepare_order_item_confirmation on public.order_items;
create trigger prepare_order_item_confirmation
before insert or update of confirmed_quantity, confirmed_unit_price
on public.order_items for each row execute function public.prepare_order_item_confirmation();

create or replace function public.refresh_order_confirmed_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o
  set confirmed_subtotal = totals.amount,
      confirmed_total = totals.amount,
      updated_at = now()
  from (
    select coalesce(sum(confirmed_line_total), 0) amount
    from public.order_items where order_id = target_order_id
  ) totals
  where o.id = target_order_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists refresh_order_confirmed_totals_insert_delete on public.order_items;
create trigger refresh_order_confirmed_totals_insert_delete
after insert or delete on public.order_items
for each row execute function public.refresh_order_confirmed_totals();

drop trigger if exists refresh_order_confirmed_totals_update on public.order_items;
create trigger refresh_order_confirmed_totals_update
after update of confirmed_quantity, confirmed_unit_price on public.order_items
for each row execute function public.refresh_order_confirmed_totals();

update public.orders o
set confirmed_subtotal = totals.amount, confirmed_total = totals.amount
from (
  select order_id, coalesce(sum(confirmed_line_total), 0) amount
  from public.order_items group by order_id
) totals where o.id = totals.order_id;

create or replace function public.confirm_order_item(
  p_order_item_id uuid,
  p_confirmed_quantity integer,
  p_confirmed_unit_price numeric,
  p_allocated_quantity integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item_row record;
  product_stock integer;
  allocation_difference integer;
  resulting integer;
begin
  if not public.is_owner_or_staff() then raise exception 'Only active owner or staff can confirm order items' using errcode = '42501'; end if;
  select oi.id, oi.order_id, oi.product_id, oi.quantity, oi.allocated_quantity, o.order_number
  into item_row from public.order_items oi join public.orders o on o.id = oi.order_id
  where oi.id = p_order_item_id for update of oi;
  if not found then raise exception 'Order item was not found'; end if;
  if p_confirmed_quantity is null or p_confirmed_quantity < 1 then raise exception 'Confirmed quantity must be a positive whole number'; end if;
  if p_confirmed_unit_price is null or p_confirmed_unit_price < 0 then raise exception 'Confirmed unit price cannot be negative'; end if;
  if p_allocated_quantity is null or p_allocated_quantity < 0 or p_allocated_quantity > p_confirmed_quantity then
    raise exception 'Allocated quantity must be between 0 and confirmed quantity';
  end if;
  if item_row.product_id is null then raise exception 'The original product no longer exists'; end if;
  select stock_quantity into product_stock from public.products where id = item_row.product_id for update;
  allocation_difference := p_allocated_quantity - item_row.allocated_quantity;
  if allocation_difference > product_stock then raise exception 'Not enough current stock to increase allocation'; end if;
  resulting := product_stock - allocation_difference;
  update public.products set stock_quantity = resulting where id = item_row.product_id;
  update public.order_items
  set confirmed_quantity = p_confirmed_quantity,
      confirmed_unit_price = p_confirmed_unit_price,
      allocated_quantity = p_allocated_quantity
  where id = item_row.id;
  if allocation_difference <> 0 then
    insert into public.inventory_movements (product_id, movement_type, quantity, previous_stock, resulting_stock, note, order_id, created_by)
    values (item_row.product_id,
      (case when allocation_difference > 0 then 'stock_out' else 'stock_in' end)::public.inventory_movement_type,
      abs(allocation_difference), product_stock, resulting,
      'Allocation adjusted for order ' || item_row.order_number, item_row.order_id, auth.uid());
  end if;
end;
$$;

revoke all on function public.confirm_order_item(uuid, integer, numeric, integer) from public;
grant execute on function public.confirm_order_item(uuid, integer, numeric, integer) to authenticated;

-- Rollback requires retaining requested quantity/unit_price/line_total. Drop only the confirmation
-- RPC/triggers/columns after exporting confirmed values for any live orders.
