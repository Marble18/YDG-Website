-- PR #11: active staff receive operational permissions without owner-identity controls.

drop policy if exists pr11_manager_products_insert on public.products;
drop policy if exists pr11_manager_products_update on public.products;
create policy pr11_manager_products_insert on public.products
for insert to authenticated
with check (public.is_owner_or_staff());
create policy pr11_manager_products_update on public.products
for update to authenticated
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());
grant select, insert, update on public.products to authenticated;

drop policy if exists pr11_manager_categories_insert on public.categories;
drop policy if exists pr11_manager_categories_update on public.categories;
create policy pr11_manager_categories_insert on public.categories
for insert to authenticated
with check (public.is_owner_or_staff());
create policy pr11_manager_categories_update on public.categories
for update to authenticated
using (public.is_owner_or_staff())
with check (public.is_owner_or_staff());
grant select, insert, update on public.categories to authenticated;

drop policy if exists pr11_manager_inventory_read on public.inventory_movements;
create policy pr11_manager_inventory_read on public.inventory_movements
for select to authenticated
using (public.is_owner_or_staff());
grant select on public.inventory_movements to authenticated;
revoke insert, update, delete on public.inventory_movements from authenticated;

create or replace function public.record_stock_movement(
  p_product_id uuid,
  p_direction text,
  p_quantity integer,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_stock integer;
  resulting_stock integer;
begin
  if not public.is_owner_or_staff() then
    raise exception 'Active owner or staff access is required' using errcode = '42501';
  end if;
  if p_product_id is null then raise exception 'Product ID is required'; end if;
  if p_direction not in ('in', 'out') then raise exception 'Stock direction must be in or out'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'Quantity must be a positive whole number'; end if;

  select stock_quantity into current_stock
  from public.products
  where id = p_product_id
  for update;
  if not found then raise exception 'Product was not found'; end if;

  resulting_stock := current_stock + case when p_direction = 'in' then p_quantity else -p_quantity end;
  if resulting_stock < 0 then raise exception 'Stock out quantity exceeds current stock'; end if;

  update public.products
  set stock_quantity = resulting_stock, updated_at = now()
  where id = p_product_id;

  insert into public.inventory_movements (
    product_id, movement_type, quantity, previous_stock, resulting_stock, note, created_by
  ) values (
    p_product_id,
    (case when p_direction = 'in' then 'stock_in' else 'stock_out' end)::public.inventory_movement_type,
    p_quantity,
    current_stock,
    resulting_stock,
    coalesce(nullif(btrim(p_note), ''), 'Manual adjustment'),
    auth.uid()
  );
  return resulting_stock;
end;
$$;

revoke all on function public.record_stock_movement(uuid, text, integer, text) from public;
grant execute on function public.record_stock_movement(uuid, text, integer, text) to authenticated;

create or replace function public.update_product_with_stock(
  p_product_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_category_id uuid,
  p_price numeric,
  p_stock_quantity integer,
  p_unit text,
  p_minimum_order_quantity integer,
  p_image_url text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_product public.products%rowtype;
  stock_difference integer;
begin
  if not public.is_owner_or_staff() then
    raise exception 'Active owner or staff access is required' using errcode = '42501';
  end if;
  if p_product_id is null then raise exception 'Product ID is required'; end if;
  if p_expected_updated_at is null then raise exception 'Product version is required; reload and try again'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'Product name is required'; end if;
  if p_price is null or p_price < 0 then raise exception 'Product price cannot be negative'; end if;
  if p_stock_quantity is null or p_stock_quantity < 0 then raise exception 'Stock must be a whole number of 0 or more'; end if;
  if p_unit not in ('pcs', 'box') then raise exception 'Product unit must be pcs or box'; end if;
  if p_minimum_order_quantity is null or p_minimum_order_quantity < 1 then
    raise exception 'Minimum order quantity must be a positive whole number';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'Product category was not found';
  end if;

  select * into current_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product was not found'; end if;
  if current_product.updated_at is distinct from p_expected_updated_at then
    raise exception 'This product changed after the form was opened. Reload and try again' using errcode = '40001';
  end if;

  stock_difference := p_stock_quantity - current_product.stock_quantity;
  update public.products
  set name = btrim(p_name), category_id = p_category_id, price = p_price,
      stock_quantity = p_stock_quantity, unit = p_unit,
      minimum_order_quantity = p_minimum_order_quantity, image_url = p_image_url,
      is_active = p_is_active, updated_at = now()
  where id = p_product_id;

  if stock_difference <> 0 then
    insert into public.inventory_movements (
      product_id, movement_type, quantity, previous_stock, resulting_stock, note, created_by
    ) values (
      p_product_id,
      (case when stock_difference > 0 then 'stock_in' else 'stock_out' end)::public.inventory_movement_type,
      abs(stock_difference), current_product.stock_quantity, p_stock_quantity,
      'Product edit stock adjustment', auth.uid()
    );
  end if;
end;
$$;

revoke all on function public.update_product_with_stock(
  uuid, timestamptz, text, uuid, numeric, integer, text, integer, text, boolean
) from public;
grant execute on function public.update_product_with_stock(
  uuid, timestamptz, text, uuid, numeric, integer, text, integer, text, boolean
) to authenticated;

create or replace function public.update_order_status(p_order_id uuid, p_new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare current_status text;
begin
  if not public.is_owner_or_staff() then
    raise exception 'Active owner or staff access is required' using errcode = '42501';
  end if;
  select status::text into current_status from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order was not found'; end if;
  if not (
    (current_status = 'pending' and p_new_status = 'approved') or
    (current_status = 'approved' and p_new_status = 'processing') or
    (current_status = 'processing' and p_new_status = 'ready_to_ship') or
    (current_status = 'ready_to_ship' and p_new_status = 'delivered')
  ) then raise exception 'Invalid order status transition from % to %', current_status, p_new_status; end if;
  execute format('update public.orders set status = %L, updated_at = now() where id = %L', p_new_status, p_order_id);
end;
$$;

revoke all on function public.update_order_status(uuid, text) from public;
grant execute on function public.update_order_status(uuid, text) to authenticated;

comment on function public.record_stock_movement(uuid, text, integer, text)
is 'Atomic active-owner/staff stock movement with row locking and inventory audit.';
comment on function public.update_product_with_stock(
  uuid, timestamptz, text, uuid, numeric, integer, text, integer, text, boolean
) is 'Atomic active-owner/staff product edit with optimistic locking and stock movement audit.';

-- Rollback: remove only the pr11_* policies and restore the PR #10 owner-only
-- update_product_with_stock/update_order_status definitions. Drop record_stock_movement
-- only after the frontend no longer calls it. Existing movement audit rows remain valid.
