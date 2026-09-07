-- Production pcs/box sales modes, unit-scoped carts, and immutable order snapshots.

alter table public.products
  add column if not exists sales_mode text,
  add column if not exists pcs_price numeric,
  add column if not exists box_price numeric,
  add column if not exists pieces_per_box integer,
  add column if not exists minimum_pcs_quantity integer,
  add column if not exists minimum_box_quantity integer;

update public.products
set sales_mode = case when unit = 'box' then 'box_only' else 'pcs_only' end,
    pcs_price = case when unit = 'box' then null else price end,
    box_price = case when unit = 'box' then price else null end,
    pieces_per_box = case when unit = 'box' then 1 else null end,
    minimum_pcs_quantity = case when unit = 'box' then null else minimum_order_quantity end,
    minimum_box_quantity = case when unit = 'box' then minimum_order_quantity else null end
where sales_mode is null;

alter table public.products
  alter column sales_mode set not null,
  drop constraint if exists products_sales_mode_check,
  add constraint products_sales_mode_check check (sales_mode in ('pcs_only', 'box_only', 'pcs_and_box')),
  drop constraint if exists products_sales_configuration_check,
  add constraint products_sales_configuration_check check (
    (sales_mode = 'pcs_only' and pcs_price is not null and pcs_price >= 0
      and minimum_pcs_quantity is not null and minimum_pcs_quantity >= 1
      and box_price is null and pieces_per_box is null and minimum_box_quantity is null)
    or
    (sales_mode = 'box_only' and box_price is not null and box_price >= 0
      and pieces_per_box is not null and pieces_per_box >= 1
      and minimum_box_quantity is not null and minimum_box_quantity >= 1
      and pcs_price is null and minimum_pcs_quantity is null)
    or
    (sales_mode = 'pcs_and_box' and pcs_price is not null and pcs_price >= 0
      and minimum_pcs_quantity is not null and minimum_pcs_quantity >= 1
      and box_price is not null and box_price >= 0
      and pieces_per_box is not null and pieces_per_box >= 1
      and minimum_box_quantity is not null and minimum_box_quantity >= 1)
  );

create or replace function public.sync_product_sales_compatibility()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.sales_mode = 'box_only' then
    new.unit := 'box';
    new.price := new.box_price;
    new.minimum_order_quantity := new.minimum_box_quantity;
  else
    new.unit := 'pcs';
    new.price := new.pcs_price;
    new.minimum_order_quantity := new.minimum_pcs_quantity;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_product_sales_compatibility on public.products;
create trigger sync_product_sales_compatibility
before insert or update of sales_mode, pcs_price, box_price, pieces_per_box,
  minimum_pcs_quantity, minimum_box_quantity
on public.products for each row execute function public.sync_product_sales_compatibility();

alter table public.cart_items add column if not exists selected_unit text;
update public.cart_items c
set selected_unit = case when p.sales_mode = 'box_only' then 'box' else 'pcs' end
from public.products p
where p.id = c.product_id and c.selected_unit is null;
delete from public.cart_items where selected_unit is null;
alter table public.cart_items
  alter column selected_unit set not null,
  drop constraint if exists cart_items_selected_unit_check,
  add constraint cart_items_selected_unit_check check (selected_unit in ('pcs', 'box'));
drop index if exists public.cart_items_customer_product_unique;
create unique index if not exists cart_items_customer_product_unit_unique
  on public.cart_items (customer_id, product_id, selected_unit);

alter table public.order_items
  add column if not exists pieces_per_box_snapshot integer,
  add column if not exists equivalent_requested_pcs integer,
  add column if not exists confirmed_unit text,
  add column if not exists equivalent_confirmed_pcs integer;

update public.order_items
set pieces_per_box_snapshot = case when unit = 'box' then 1 else null end,
    equivalent_requested_pcs = case when unit = 'box' then quantity else quantity end,
    confirmed_unit = unit,
    equivalent_confirmed_pcs = case when unit = 'box' then confirmed_quantity else confirmed_quantity end
where equivalent_requested_pcs is null or confirmed_unit is null or equivalent_confirmed_pcs is null;

alter table public.order_items
  alter column equivalent_requested_pcs set not null,
  alter column confirmed_unit set not null,
  alter column equivalent_confirmed_pcs set not null,
  drop constraint if exists order_items_unit_snapshot_check,
  add constraint order_items_unit_snapshot_check check (
    unit in ('pcs', 'box') and confirmed_unit = unit
    and equivalent_requested_pcs >= 1 and equivalent_confirmed_pcs >= 1
    and ((unit = 'pcs' and pieces_per_box_snapshot is null and equivalent_requested_pcs = quantity and equivalent_confirmed_pcs = confirmed_quantity)
      or (unit = 'box' and pieces_per_box_snapshot is not null and pieces_per_box_snapshot >= 1
        and equivalent_requested_pcs = quantity * pieces_per_box_snapshot
        and equivalent_confirmed_pcs = confirmed_quantity * pieces_per_box_snapshot))
  );

create or replace function public.prepare_order_item_unit_snapshots()
returns trigger language plpgsql set search_path = public as $$
begin
  new.confirmed_unit := new.unit;
  if new.unit = 'box' then
    if new.pieces_per_box_snapshot is null or new.pieces_per_box_snapshot < 1 then
      raise exception 'Box order items require a valid pieces-per-box snapshot';
    end if;
    new.equivalent_requested_pcs := new.quantity * new.pieces_per_box_snapshot;
    new.equivalent_confirmed_pcs := new.confirmed_quantity * new.pieces_per_box_snapshot;
  else
    new.pieces_per_box_snapshot := null;
    new.equivalent_requested_pcs := new.quantity;
    new.equivalent_confirmed_pcs := new.confirmed_quantity;
  end if;
  return new;
end;
$$;

drop trigger if exists prepare_order_item_unit_snapshots on public.order_items;
create trigger prepare_order_item_unit_snapshots
before insert or update of unit, quantity, confirmed_quantity, pieces_per_box_snapshot
on public.order_items for each row execute function public.prepare_order_item_unit_snapshots();

drop function if exists public.set_cart_item(uuid, integer);
create or replace function public.set_cart_item(p_product_id uuid, p_selected_unit text, p_quantity integer)
returns void language plpgsql security definer set search_path = public as $$
declare product_row public.products%rowtype; required_minimum integer;
begin
  perform public.require_active_customer();
  select * into product_row from public.products
  where id = p_product_id and is_active = true and deleted_at is null;
  if not found then raise exception 'Product is unavailable'; end if;
  if p_selected_unit not in ('pcs', 'box') then raise exception 'Choose pcs or box'; end if;
  if (p_selected_unit = 'pcs' and product_row.sales_mode not in ('pcs_only','pcs_and_box'))
    or (p_selected_unit = 'box' and product_row.sales_mode not in ('box_only','pcs_and_box')) then
    raise exception 'The selected sales unit is unavailable';
  end if;
  required_minimum := case when p_selected_unit = 'box' then product_row.minimum_box_quantity else product_row.minimum_pcs_quantity end;
  if required_minimum is null or p_quantity is null or p_quantity < required_minimum then
    raise exception 'Quantity must be at least % %', required_minimum, p_selected_unit;
  end if;
  insert into public.cart_items (customer_id, product_id, selected_unit, quantity)
  values (auth.uid(), p_product_id, p_selected_unit, p_quantity)
  on conflict (customer_id, product_id, selected_unit)
  do update set quantity = excluded.quantity, updated_at = now();
end;
$$;

drop function if exists public.remove_cart_item(uuid);
create or replace function public.remove_cart_item(p_product_id uuid, p_selected_unit text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_active_customer();
  if p_selected_unit not in ('pcs','box') then raise exception 'Choose pcs or box'; end if;
  delete from public.cart_items
  where customer_id = auth.uid() and product_id = p_product_id and selected_unit = p_selected_unit;
end;
$$;

create or replace function public.checkout_cart(
  p_idempotency_key uuid, p_phone text, p_delivery_address text,
  p_bus_station text default null, p_delivery_date date default null,
  p_customer_note text default null
)
returns table(order_id uuid, order_number text, total numeric)
language plpgsql security definer set search_path = public as $$
declare created_order_id uuid; created_order_number text; calculated_total numeric;
begin
  perform public.require_active_customer();
  if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if nullif(btrim(p_phone), '') is null then raise exception 'Contact phone is required'; end if;
  if nullif(btrim(p_delivery_address), '') is null then raise exception 'Delivery address is required'; end if;
  select o.id, o.order_number, o.total into created_order_id, created_order_number, calculated_total
  from public.orders o where o.customer_id = auth.uid() and o.idempotency_key = p_idempotency_key;
  if found then return query select created_order_id, created_order_number, calculated_total; return; end if;
  perform 1 from public.cart_items where customer_id = auth.uid() for update;
  if not found then raise exception 'Cart is empty'; end if;
  if exists (
    select 1 from public.cart_items c left join public.products p on p.id = c.product_id
    where c.customer_id = auth.uid() and (p.id is null or not p.is_active or p.deleted_at is not null
      or c.selected_unit not in ('pcs','box')
      or (c.selected_unit = 'pcs' and (p.sales_mode not in ('pcs_only','pcs_and_box') or c.quantity < p.minimum_pcs_quantity))
      or (c.selected_unit = 'box' and (p.sales_mode not in ('box_only','pcs_and_box') or c.quantity < p.minimum_box_quantity or p.pieces_per_box < 1)))
  ) then raise exception 'Cart contains an unavailable product, unit, or invalid quantity'; end if;
  select coalesce(sum((case when c.selected_unit = 'box' then p.box_price else p.pcs_price end) * c.quantity), 0)
  into calculated_total from public.cart_items c join public.products p on p.id = c.product_id
  where c.customer_id = auth.uid();
  created_order_number := public.next_public_order_number();
  insert into public.orders (order_number, customer_id, status, delivery_address, bus_station,
    contact_phone, preferred_delivery_date, subtotal, total, customer_note, idempotency_key)
  values (created_order_number, auth.uid(), 'pending', btrim(p_delivery_address), nullif(btrim(p_bus_station), ''),
    btrim(p_phone), p_delivery_date, calculated_total, calculated_total, nullif(btrim(p_customer_note), ''), p_idempotency_key)
  returning id into created_order_id;
  insert into public.order_items (order_id, product_id, product_name, unit, unit_price, quantity,
    line_total, pieces_per_box_snapshot, equivalent_requested_pcs, confirmed_unit, equivalent_confirmed_pcs)
  select created_order_id, p.id, p.name, c.selected_unit,
    case when c.selected_unit = 'box' then p.box_price else p.pcs_price end,
    c.quantity,
    (case when c.selected_unit = 'box' then p.box_price else p.pcs_price end) * c.quantity,
    case when c.selected_unit = 'box' then p.pieces_per_box else null end,
    case when c.selected_unit = 'box' then c.quantity * p.pieces_per_box else c.quantity end,
    c.selected_unit,
    case when c.selected_unit = 'box' then c.quantity * p.pieces_per_box else c.quantity end
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.customer_id = auth.uid() order by c.created_at, c.id;
  delete from public.cart_items where customer_id = auth.uid();
  return query select created_order_id, created_order_number, calculated_total;
end;
$$;

drop function if exists public.update_product_with_stock(uuid, timestamptz, text, uuid, numeric, integer, text, integer, text, boolean);
create or replace function public.update_product_with_stock(
  p_product_id uuid, p_expected_updated_at timestamptz, p_name text, p_category_id uuid,
  p_sales_mode text, p_pcs_price numeric, p_box_price numeric, p_pieces_per_box integer,
  p_minimum_pcs_quantity integer, p_minimum_box_quantity integer,
  p_stock_quantity integer, p_image_url text, p_is_active boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare current_product public.products%rowtype; stock_difference integer;
begin
  if not public.is_owner_or_staff() then raise exception 'Only active owner or staff can edit products' using errcode = '42501'; end if;
  if p_product_id is null then raise exception 'Product ID is required'; end if;
  if p_expected_updated_at is null then raise exception 'Product version is required; reload and try again'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'Product name is required'; end if;
  if p_stock_quantity is null or p_stock_quantity < 0 then raise exception 'Stock must be a whole number of 0 or more'; end if;
  if p_sales_mode not in ('pcs_only','box_only','pcs_and_box') then raise exception 'Sales mode is invalid'; end if;
  if p_sales_mode in ('pcs_only','pcs_and_box') and (p_pcs_price is null or p_pcs_price < 0 or p_minimum_pcs_quantity is null or p_minimum_pcs_quantity < 1) then
    raise exception 'Pcs price and minimum quantity are invalid';
  end if;
  if p_sales_mode in ('box_only','pcs_and_box') and (p_box_price is null or p_box_price < 0 or p_pieces_per_box is null or p_pieces_per_box < 1 or p_minimum_box_quantity is null or p_minimum_box_quantity < 1) then
    raise exception 'Box price, pieces per box, and minimum quantity are invalid';
  end if;
  if p_sales_mode = 'pcs_only' and (p_box_price is not null or p_pieces_per_box is not null or p_minimum_box_quantity is not null) then raise exception 'Box fields must be empty for pcs-only products'; end if;
  if p_sales_mode = 'box_only' and (p_pcs_price is not null or p_minimum_pcs_quantity is not null) then raise exception 'Pcs fields must be empty for box-only products'; end if;
  if not exists (select 1 from public.categories where id = p_category_id) then raise exception 'Product category was not found'; end if;
  select * into current_product from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'Product was not found'; end if;
  if current_product.updated_at is distinct from p_expected_updated_at then
    raise exception 'This product changed after the form was opened. Reload and try again' using errcode = '40001';
  end if;
  stock_difference := p_stock_quantity - current_product.stock_quantity;
  update public.products set name=btrim(p_name), category_id=p_category_id, sales_mode=p_sales_mode,
    pcs_price=p_pcs_price, box_price=p_box_price, pieces_per_box=p_pieces_per_box,
    minimum_pcs_quantity=p_minimum_pcs_quantity, minimum_box_quantity=p_minimum_box_quantity,
    stock_quantity=p_stock_quantity, image_url=p_image_url, is_active=p_is_active, updated_at=now()
  where id=p_product_id;
  if stock_difference <> 0 then
    insert into public.inventory_movements(product_id,movement_type,quantity,previous_stock,resulting_stock,note,created_by)
    values(p_product_id,(case when stock_difference>0 then 'stock_in' else 'stock_out' end)::public.inventory_movement_type,
      abs(stock_difference),current_product.stock_quantity,p_stock_quantity,'Product edit stock adjustment',auth.uid());
  end if;
end;
$$;

create or replace function public.adjust_product_category_prices(p_category_id uuid, p_percentage numeric)
returns integer language plpgsql security definer set search_path = public as $$
declare changed_count integer;
begin
  if not public.is_owner_or_staff() then raise exception 'Only an active owner or staff account can adjust prices' using errcode='42501'; end if;
  if p_percentage is null or p_percentage < -100 or p_percentage > 10000 then raise exception 'Percentage is outside the allowed range'; end if;
  update public.products
  set pcs_price = case when pcs_price is null then null else greatest(0, round((pcs_price * (1 + p_percentage / 100)) / 50) * 50) end,
      box_price = case when box_price is null then null else greatest(0, round((box_price * (1 + p_percentage / 100)) / 50) * 50) end,
      updated_at = now()
  where category_id = p_category_id and is_active = true and deleted_at is null;
  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.set_cart_item(uuid,text,integer) from public;
revoke all on function public.remove_cart_item(uuid,text) from public;
revoke all on function public.checkout_cart(uuid,text,text,text,date,text) from public;
revoke all on function public.update_product_with_stock(uuid,timestamptz,text,uuid,text,numeric,numeric,integer,integer,integer,integer,text,boolean) from public;
grant execute on function public.set_cart_item(uuid,text,integer) to authenticated;
grant execute on function public.remove_cart_item(uuid,text) to authenticated;
grant execute on function public.checkout_cart(uuid,text,text,text,date,text) to authenticated;
grant execute on function public.update_product_with_stock(uuid,timestamptz,text,uuid,text,numeric,numeric,integer,integer,integer,integer,text,boolean) to authenticated;
revoke all on function public.adjust_product_category_prices(uuid,numeric) from public;
grant execute on function public.adjust_product_category_prices(uuid,numeric) to authenticated;

comment on column public.products.stock_quantity is 'Physical stock in pieces. Ordering is stock-independent and never mutates this value.';
comment on column public.order_items.confirmed_unit is 'Locked to requested unit; owner may confirm quantity and price only.';

-- Rollback: keep order snapshot columns once production orders use them. Recreate the prior RPCs,
-- collapse duplicate product/unit cart lines deliberately, and only then restore the old unique index.
