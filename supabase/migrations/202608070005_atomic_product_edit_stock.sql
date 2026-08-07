-- Make owner product edits and their stock history one atomic operation.

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
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner' and is_active = true
  ) then
    raise exception 'Only an active owner can edit products' using errcode = '42501';
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

  select * into current_product
  from public.products
  where id = p_product_id
  for update;
  if not found then raise exception 'Product was not found'; end if;

  if current_product.updated_at is distinct from p_expected_updated_at then
    raise exception 'This product changed after the form was opened. Reload and try again' using errcode = '40001';
  end if;

  stock_difference := p_stock_quantity - current_product.stock_quantity;

  update public.products
  set name = btrim(p_name),
      category_id = p_category_id,
      price = p_price,
      stock_quantity = p_stock_quantity,
      unit = p_unit,
      minimum_order_quantity = p_minimum_order_quantity,
      image_url = p_image_url,
      is_active = p_is_active,
      updated_at = now()
  where id = p_product_id;

  if stock_difference <> 0 then
    insert into public.inventory_movements (
      product_id, movement_type, quantity, previous_stock, resulting_stock, note, created_by
    ) values (
      p_product_id,
      (case when stock_difference > 0 then 'stock_in' else 'stock_out' end)::public.inventory_movement_type,
      abs(stock_difference),
      current_product.stock_quantity,
      p_stock_quantity,
      'Product edit stock adjustment',
      auth.uid()
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

comment on function public.update_product_with_stock(
  uuid, timestamptz, text, uuid, numeric, integer, text, integer, text, boolean
) is 'Active-owner-only atomic product edit with optimistic locking and stock movement audit.';

-- Rollback: drop this function and restore direct product updates only if the caller also
-- restores an atomic stock-history mechanism. Existing movements remain valid audit history.
