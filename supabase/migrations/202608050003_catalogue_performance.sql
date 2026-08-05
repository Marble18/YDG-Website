-- Product catalogue indexes for database-side filtering, search and stable pagination.
-- Existing RLS already exposes active products to shoppers and all products to owner/staff.

create extension if not exists pg_trgm with schema extensions;

create index if not exists products_active_catalogue_order_idx
  on public.products (created_at, id)
  where is_active = true;

create index if not exists products_active_category_order_idx
  on public.products (category_id, created_at, id)
  where is_active = true;

create index if not exists products_owner_status_order_idx
  on public.products (is_active, created_at, id);

create index if not exists products_name_trgm_idx
  on public.products using gin (name extensions.gin_trgm_ops);

-- Keep the existing category pricing tool correct when only one catalogue page is loaded.
create or replace function public.adjust_product_category_prices(
  p_category_id uuid,
  p_percentage numeric
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer;
begin
  if not public.is_owner_or_staff() then
    raise exception 'Only an active owner or staff account can adjust prices';
  end if;
  if p_percentage is null or p_percentage < -100 or p_percentage > 10000 then
    raise exception 'Percentage is outside the allowed range';
  end if;

  update public.products
  set price = greatest(0, round((price * (1 + p_percentage / 100)) / 50) * 50)
  where category_id = p_category_id
    and is_active = true;
  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.adjust_product_category_prices(uuid, numeric) from public;
grant execute on function public.adjust_product_category_prices(uuid, numeric) to authenticated;
