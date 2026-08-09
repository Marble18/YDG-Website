-- PR #12: manager-only category listing and concurrency-safe empty category deletion.
-- Rollback: drop the two functions below. Keep the RESTRICT foreign key because it
-- prevents accidental product reassignment/deletion and is safer than ON DELETE SET NULL.

do $$
declare
  category_fk_name text;
  category_fk_delete_action "char";
begin
  select c.conname, c.confdeltype
  into category_fk_name, category_fk_delete_action
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = any (c.conkey)
  where c.contype = 'f'
    and c.conrelid = 'public.products'::regclass
    and c.confrelid = 'public.categories'::regclass
    and a.attname = 'category_id'
  limit 1;

  if category_fk_name is null then
    raise exception 'Products category foreign key was not found';
  end if;

  if category_fk_delete_action <> 'r' then
    execute format('alter table public.products drop constraint %I', category_fk_name);
    execute format(
      'alter table public.products add constraint %I foreign key (category_id) references public.categories(id) on delete restrict',
      category_fk_name
    );
  end if;
end;
$$;

create or replace function public.list_managed_categories()
returns table (
  id uuid,
  name text,
  is_active boolean,
  product_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner_or_staff() then
    raise exception 'Active owner or staff access is required' using errcode = '42501';
  end if;

  return query
  select c.id, c.name, c.is_active, count(p.id)::bigint
  from public.categories c
  left join public.products p on p.category_id = c.id
  group by c.id, c.name, c.is_active
  order by lower(c.name), c.id;
end;
$$;

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

revoke all on function public.list_managed_categories() from public;
revoke all on function public.delete_empty_category(uuid) from public;
grant execute on function public.list_managed_categories() to authenticated;
grant execute on function public.delete_empty_category(uuid) to authenticated;

-- Direct table deletion stays unavailable; all deletions must pass the RPC checks.
revoke delete on public.categories from anon, authenticated;
