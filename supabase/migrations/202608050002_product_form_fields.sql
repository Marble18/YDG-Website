-- Product unit/minimum-order fields and case-insensitive category integrity.

alter table public.products
  add column if not exists unit text not null default 'pcs',
  add column if not exists minimum_order_quantity integer not null default 1;

alter table public.products
  drop constraint if exists products_unit_check,
  add constraint products_unit_check check (unit in ('pcs', 'box')),
  drop constraint if exists products_minimum_order_quantity_check,
  add constraint products_minimum_order_quantity_check check (minimum_order_quantity >= 1);

update public.products
set unit = 'pcs'
where unit is null or unit not in ('pcs', 'box');

update public.products
set minimum_order_quantity = 1
where minimum_order_quantity is null or minimum_order_quantity < 1;

-- Consolidate any historical categories that differ only by case or outer spaces.
create temporary table category_duplicates on commit drop as
select id as duplicate_id, canonical_id
from (
  select
    id,
    first_value(id) over (
      partition by lower(btrim(name))
      order by created_at nulls last, id
    ) as canonical_id,
    row_number() over (
      partition by lower(btrim(name))
      order by created_at nulls last, id
    ) as duplicate_rank
  from public.categories
) ranked
where duplicate_rank > 1;

update public.products product
set category_id = duplicate.canonical_id
from category_duplicates duplicate
where product.category_id = duplicate.duplicate_id;

delete from public.categories category
using category_duplicates duplicate
where category.id = duplicate.duplicate_id;

update public.categories
set name = btrim(name)
where name <> btrim(name);

alter table public.categories
  drop constraint if exists categories_name_trimmed_check,
  add constraint categories_name_trimmed_check check (name <> '' and name = btrim(name));

create unique index if not exists categories_name_lower_unique
  on public.categories (lower(name));
