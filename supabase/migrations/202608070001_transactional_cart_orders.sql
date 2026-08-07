-- Account-scoped carts and stock-independent, transactional checkout.

alter table public.cart_items
  drop constraint if exists cart_items_quantity_check,
  add constraint cart_items_quantity_check check (quantity >= 1);

create unique index if not exists cart_items_customer_product_unique
  on public.cart_items (customer_id, product_id);

alter table public.orders
  add column if not exists idempotency_key uuid,
  add column if not exists contact_phone text,
  add column if not exists preferred_delivery_date date;

create unique index if not exists orders_customer_idempotency_unique
  on public.orders (customer_id, idempotency_key)
  where idempotency_key is not null;

alter table public.order_items
  add column if not exists unit text not null default 'pcs',
  add column if not exists allocated_quantity integer not null default 0,
  add column if not exists picked boolean not null default false,
  drop constraint if exists order_items_allocated_quantity_check,
  add constraint order_items_allocated_quantity_check
    check (allocated_quantity >= 0 and allocated_quantity <= quantity);

create or replace function public.require_active_customer()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'customer' and is_active = true
  ) then
    raise exception 'An active customer account is required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.is_active_account(check_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = check_user_id and is_active = true) $$;

create or replace function public.set_cart_item(p_product_id uuid, p_quantity integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare product_minimum integer;
begin
  perform public.require_active_customer();
  select minimum_order_quantity into product_minimum
  from public.products where id = p_product_id and is_active = true;
  if product_minimum is null then raise exception 'Product is unavailable'; end if;
  if p_quantity is null or p_quantity < product_minimum then
    raise exception 'Quantity must be at least %', product_minimum;
  end if;
  insert into public.cart_items (customer_id, product_id, quantity)
  values (auth.uid(), p_product_id, p_quantity)
  on conflict (customer_id, product_id)
  do update set quantity = excluded.quantity, updated_at = now();
end;
$$;

create or replace function public.remove_cart_item(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_active_customer();
  delete from public.cart_items where customer_id = auth.uid() and product_id = p_product_id;
end;
$$;

create or replace function public.checkout_cart(
  p_idempotency_key uuid,
  p_phone text,
  p_delivery_address text,
  p_bus_station text default null,
  p_delivery_date date default null,
  p_customer_note text default null
)
returns table(order_id uuid, order_number text, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  created_order_id uuid;
  created_order_number text;
  calculated_total numeric;
  cart_row record;
  previous_stock integer;
  allocated integer;
begin
  perform public.require_active_customer();
  if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if nullif(btrim(p_phone), '') is null then raise exception 'Contact phone is required'; end if;
  if nullif(btrim(p_delivery_address), '') is null then raise exception 'Delivery address is required'; end if;

  select o.id, o.order_number, o.total
  into created_order_id, created_order_number, calculated_total
  from public.orders o
  where o.customer_id = auth.uid() and o.idempotency_key = p_idempotency_key;
  if found then return query select created_order_id, created_order_number, calculated_total; return; end if;

  perform 1 from public.cart_items where customer_id = auth.uid() for update;
  if not found then raise exception 'Cart is empty'; end if;

  if exists (
    select 1 from public.cart_items c left join public.products p on p.id = c.product_id
    where c.customer_id = auth.uid()
      and (p.id is null or not p.is_active or c.quantity < p.minimum_order_quantity)
  ) then raise exception 'Cart contains an unavailable product or invalid quantity'; end if;

  select coalesce(sum(p.price * c.quantity), 0)
  into calculated_total
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.customer_id = auth.uid();

  created_order_number := 'YT-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 6));
  insert into public.orders (order_number, customer_id, status, delivery_address, bus_station,
    contact_phone, preferred_delivery_date, subtotal, total, customer_note, idempotency_key)
  values (created_order_number, auth.uid(), 'pending', btrim(p_delivery_address), nullif(btrim(p_bus_station), ''),
    btrim(p_phone), p_delivery_date, calculated_total, calculated_total, nullif(btrim(p_customer_note), ''), p_idempotency_key)
  returning id into created_order_id;

  for cart_row in
    select c.product_id, c.quantity, p.name, p.price, p.unit, p.stock_quantity
    from public.cart_items c join public.products p on p.id = c.product_id
    where c.customer_id = auth.uid() order by c.created_at for update of p
  loop
    previous_stock := cart_row.stock_quantity;
    allocated := least(previous_stock, cart_row.quantity);
    insert into public.order_items (order_id, product_id, product_name, unit, unit_price,
      quantity, allocated_quantity, line_total)
    values (created_order_id, cart_row.product_id, cart_row.name, cart_row.unit, cart_row.price,
      cart_row.quantity, allocated, cart_row.price * cart_row.quantity);
    if allocated > 0 then
      update public.products set stock_quantity = previous_stock - allocated where id = cart_row.product_id;
      insert into public.inventory_movements (product_id, movement_type, quantity, previous_stock,
        resulting_stock, note, order_id, created_by)
      values (cart_row.product_id, 'stock_out', allocated, previous_stock, previous_stock - allocated,
        'Allocated to order ' || created_order_number, created_order_id, auth.uid());
    end if;
  end loop;

  delete from public.cart_items where customer_id = auth.uid();
  return query select created_order_id, created_order_number, calculated_total;
end;
$$;

create or replace function public.set_order_item_allocation(p_order_item_id uuid, p_allocated_quantity integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item_row record;
  product_stock integer;
  difference integer;
  resulting integer;
begin
  if not public.is_owner_or_staff() then raise exception 'Only active owner or staff can allocate stock' using errcode = '42501'; end if;
  select oi.id, oi.order_id, oi.product_id, oi.quantity, oi.allocated_quantity, o.order_number
  into item_row from public.order_items oi join public.orders o on o.id = oi.order_id
  where oi.id = p_order_item_id for update of oi;
  if not found then raise exception 'Order item was not found'; end if;
  if p_allocated_quantity is null or p_allocated_quantity < 0 or p_allocated_quantity > item_row.quantity then
    raise exception 'Allocated quantity must be between 0 and requested quantity';
  end if;
  if item_row.product_id is null then raise exception 'The original product no longer exists'; end if;
  select stock_quantity into product_stock from public.products where id = item_row.product_id for update;
  difference := p_allocated_quantity - item_row.allocated_quantity;
  if difference > product_stock then raise exception 'Not enough current stock to increase allocation'; end if;
  resulting := product_stock - difference;
  update public.products set stock_quantity = resulting where id = item_row.product_id;
  update public.order_items set allocated_quantity = p_allocated_quantity where id = item_row.id;
  if difference <> 0 then
    insert into public.inventory_movements (product_id, movement_type, quantity, previous_stock, resulting_stock, note, order_id, created_by)
    values (item_row.product_id, (case when difference > 0 then 'stock_out' else 'stock_in' end)::public.inventory_movement_type,
      abs(difference), product_stock, resulting, 'Allocation adjusted for order ' || item_row.order_number,
      item_row.order_id, auth.uid());
  end if;
end;
$$;

revoke all on function public.require_active_customer() from public;
revoke all on function public.is_active_account(uuid) from public;
revoke all on function public.set_cart_item(uuid, integer) from public;
revoke all on function public.remove_cart_item(uuid) from public;
revoke all on function public.checkout_cart(uuid, text, text, text, date, text) from public;
revoke all on function public.set_order_item_allocation(uuid, integer) from public;
grant execute on function public.set_cart_item(uuid, integer) to authenticated;
grant execute on function public.remove_cart_item(uuid) to authenticated;
grant execute on function public.checkout_cart(uuid, text, text, text, date, text) to authenticated;
grant execute on function public.set_order_item_allocation(uuid, integer) to authenticated;
grant execute on function public.is_active_account(uuid) to authenticated;

-- Browsers can read their RLS-scoped rows, but cart mutation and order creation go through validated RPCs.
drop policy if exists "Customers add to own cart" on public.cart_items;
drop policy if exists "Customers update own cart" on public.cart_items;
revoke insert, update on public.cart_items from authenticated;
grant select on public.cart_items to authenticated;
grant delete on public.cart_items to authenticated;

drop policy if exists "Customers view own cart" on public.cart_items;
create policy "Active customers view own cart and staff view all"
on public.cart_items for select to authenticated
using (
  public.is_owner_or_staff()
  or (customer_id = auth.uid() and public.is_active_account())
);

drop policy if exists "Customers delete own cart items" on public.cart_items;
create policy "Active customers remove own cart and staff remove any"
on public.cart_items for delete to authenticated
using (
  public.is_owner_or_staff()
  or (customer_id = auth.uid() and public.is_active_account())
);

drop policy if exists "Customers view own orders and staff view all" on public.orders;
create policy "Active customers view own orders and staff view all"
on public.orders for select to authenticated
using (public.is_owner_or_staff() or (customer_id = auth.uid() and public.is_active_account()));

drop policy if exists "Customers view own order items and staff view all" on public.order_items;
create policy "Active customers view own order items and staff view all"
on public.order_items for select to authenticated
using (
  public.is_owner_or_staff()
  or (public.is_active_account() and exists (
    select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = auth.uid()
  ))
);

create index if not exists cart_items_customer_updated_idx on public.cart_items (customer_id, updated_at desc);
create index if not exists orders_customer_created_idx on public.orders (customer_id, created_at desc);
create index if not exists order_items_order_idx on public.order_items (order_id);

-- Rollback notes: drop the three RPCs and new indexes/columns only after exporting live orders.
-- Restoring direct cart/order writes is intentionally not automated because it weakens validation.
