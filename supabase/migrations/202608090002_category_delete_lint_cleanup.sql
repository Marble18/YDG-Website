-- Keep the deployed PR #12 function lint-clean. This is intentionally a
-- create-or-replace follow-up and is safe to run more than once.
create or replace function public.delete_empty_category(p_category_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_product_count bigint;
begin
  if not public.is_owner_or_staff() then
    raise exception 'Active owner or staff access is required' using errcode = '42501';
  end if;
  if p_category_id is null then
    raise exception 'Category ID is required' using errcode = '22004';
  end if;

  perform 1
  from public.categories
  where categories.id = p_category_id
  for update;

  if not found then
    raise exception 'Category was not found' using errcode = 'P0002';
  end if;

  select count(*) into current_product_count
  from public.products
  where category_id = p_category_id;

  if current_product_count > 0 then
    raise exception 'Category is in use by % product(s)', current_product_count using errcode = '23503';
  end if;

  delete from public.categories where id = p_category_id;
  return p_category_id;
exception
  when foreign_key_violation then
    raise exception 'Category is in use and cannot be deleted' using errcode = '23503';
end;
$$;

revoke all on function public.delete_empty_category(uuid) from public;
grant execute on function public.delete_empty_category(uuid) to authenticated;
