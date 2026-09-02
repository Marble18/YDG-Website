-- PR #20: irreversible user-facing deletion with history-preserving tombstones/snapshots.
-- No live product/customer rows are deleted by this migration.

alter table public.products
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deletion_reason text,
  add column if not exists deleted_image_url text,
  add column if not exists image_cleanup_status text not null default 'not_required',
  add column if not exists category_name_snapshot text;

alter table public.products alter column category_id drop not null;

do $$ begin
  alter table public.products add constraint products_image_cleanup_status_check
    check (image_cleanup_status in ('not_required', 'pending', 'removed', 'failed'));
exception when duplicate_object then null;
end $$;

create index if not exists products_live_catalogue_idx
  on public.products (is_active, created_at, id) where deleted_at is null;
create index if not exists products_deleted_cleanup_idx
  on public.products (image_cleanup_status, deleted_at) where deleted_at is not null;

alter table public.inventory_movements
  add column if not exists product_name_snapshot text;

update public.inventory_movements im
set product_name_snapshot = p.name
from public.products p
where p.id = im.product_id and nullif(btrim(im.product_name_snapshot), '') is null;

create or replace function public.fill_inventory_product_snapshot()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if nullif(btrim(new.product_name_snapshot), '') is null then
    select name into new.product_name_snapshot from public.products where id = new.product_id;
  end if;
  new.product_name_snapshot := coalesce(nullif(btrim(new.product_name_snapshot), ''), 'Deleted product');
  return new;
end;
$$;

drop trigger if exists pr20_inventory_product_snapshot on public.inventory_movements;
create trigger pr20_inventory_product_snapshot
before insert or update of product_id, product_name_snapshot on public.inventory_movements
for each row execute function public.fill_inventory_product_snapshot();

alter table public.orders
  add column if not exists customer_name_snapshot text,
  add column if not exists customer_username_snapshot text;

update public.orders o
set customer_name_snapshot = coalesce(nullif(btrim(o.customer_name_snapshot), ''), nullif(btrim(p.full_name), ''), p.username, 'Deleted customer'),
    customer_username_snapshot = coalesce(nullif(btrim(o.customer_username_snapshot), ''), p.username)
from public.profiles p
where p.id = o.customer_id
  and (nullif(btrim(o.customer_name_snapshot), '') is null or nullif(btrim(o.customer_username_snapshot), '') is null);

alter table public.orders alter column customer_id drop not null;

do $$
declare customer_fk_name text; customer_fk_delete_action "char";
begin
  select c.conname, c.confdeltype into customer_fk_name, customer_fk_delete_action
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.contype = 'f' and c.conrelid = 'public.orders'::regclass
    and a.attname = 'customer_id' limit 1;
  if customer_fk_name is null then
    alter table public.orders add constraint orders_customer_id_fkey
      foreign key (customer_id) references public.profiles(id) on delete set null;
  elsif customer_fk_delete_action <> 'n' then
    execute format('alter table public.orders drop constraint %I', customer_fk_name);
    execute format('alter table public.orders add constraint %I foreign key (customer_id) references public.profiles(id) on delete set null', customer_fk_name);
  end if;
end $$;

create table if not exists public.permanent_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  target_id uuid not null,
  target_type text not null check (target_type in ('product', 'customer')),
  target_label text,
  result text not null,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists permanent_deletion_audit_target_idx
  on public.permanent_deletion_audit (target_type, target_id, created_at desc);

create table if not exists public.customer_deletion_requests (
  customer_id uuid primary key,
  username_snapshot text not null,
  name_snapshot text,
  requested_by uuid not null,
  database_completed_at timestamptz not null default now(),
  auth_deleted_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now()
);

alter table public.permanent_deletion_audit enable row level security;
alter table public.customer_deletion_requests enable row level security;
revoke all on public.permanent_deletion_audit, public.customer_deletion_requests from anon, authenticated;
grant select, insert, update on public.permanent_deletion_audit, public.customer_deletion_requests to service_role;

-- Once tombstoned, browser sessions cannot mutate or restore the product.
create or replace function public.prevent_deleted_product_mutation()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.deleted_at is not null and auth.role() <> 'service_role' then
    raise exception 'Deleted products cannot be changed or restored' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists pr20_prevent_deleted_product_mutation on public.products;
create trigger pr20_prevent_deleted_product_mutation
before update on public.products for each row execute function public.prevent_deleted_product_mutation();

revoke update on public.products from authenticated;
grant update (name, description, price, stock_quantity, unit, minimum_order_quantity,
  image_url, is_active, category_id, updated_at) on public.products to authenticated;

drop policy if exists pr11_manager_products_update on public.products;
create policy pr11_manager_products_update on public.products
for update to authenticated
using (public.is_owner_or_staff() and deleted_at is null)
with check (public.is_owner_or_staff() and deleted_at is null);

create or replace function public.tombstone_product(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare p public.products%rowtype; category_label text; removed_cart_count bigint; already_deleted boolean;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner' and is_active = true) then
    raise exception 'Active owner access is required' using errcode = '42501';
  end if;
  if p_product_id is null then raise exception 'Product ID is required' using errcode = '22004'; end if;

  select * into p from public.products where id = p_product_id for update;
  if not found then raise exception 'Product was not found' using errcode = 'P0002'; end if;
  already_deleted := p.deleted_at is not null;

  if not already_deleted then
    select name into category_label from public.categories where id = p.category_id;
    delete from public.cart_items where product_id = p.id;
    get diagnostics removed_cart_count = row_count;
    update public.products set
      is_active = false, deleted_at = now(), deleted_by = auth.uid(),
      deletion_reason = 'Owner permanent delete', deleted_image_url = image_url,
      image_cleanup_status = case when image_url is null then 'not_required' else 'pending' end,
      category_name_snapshot = coalesce(category_label, category_name_snapshot),
      category_id = null, updated_at = now()
    where id = p.id returning * into p;
    insert into public.permanent_deletion_audit(actor_id, target_id, target_type, target_label, result, safe_metadata)
    values (auth.uid(), p.id, 'product', p.name, 'database_tombstoned',
      jsonb_build_object('removed_cart_items', removed_cart_count, 'had_image', p.deleted_image_url is not null));
  end if;

  return jsonb_build_object('product_id', p.id, 'product_name', p.name,
    'image_url', p.deleted_image_url, 'image_cleanup_status', p.image_cleanup_status,
    'already_deleted', already_deleted);
end;
$$;

create or replace function public.mark_product_image_cleanup(
  p_product_id uuid, p_status text, p_error_code text default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare p public.products%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service access is required' using errcode = '42501'; end if;
  if p_status not in ('not_required', 'removed', 'failed') then raise exception 'Invalid cleanup status'; end if;
  select * into p from public.products where id = p_product_id and deleted_at is not null for update;
  if not found then raise exception 'Deleted product was not found'; end if;
  update public.products set image_cleanup_status = p_status where id = p_product_id;
  insert into public.permanent_deletion_audit(actor_id, target_id, target_type, target_label, result, safe_metadata)
  values (p.deleted_by, p.id, 'product', p.name, 'image_cleanup_' || p_status,
    jsonb_strip_nulls(jsonb_build_object('error_code', p_error_code)));
end;
$$;

create or replace function public.prepare_customer_permanent_deletion(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare target public.profiles%rowtype; existing_request public.customer_deletion_requests%rowtype;
  order_count bigint; cart_count bigint;
begin
  if not public.is_owner_or_staff() then
    raise exception 'Active owner or staff access is required' using errcode = '42501';
  end if;
  if p_customer_id is null then raise exception 'Customer ID is required' using errcode = '22004'; end if;
  if p_customer_id = auth.uid() then raise exception 'You cannot delete your own account' using errcode = '42501'; end if;

  select * into target from public.profiles where id = p_customer_id for update;
  if not found then
    select * into existing_request from public.customer_deletion_requests where customer_id = p_customer_id;
    if found then
      return jsonb_build_object('customer_id', existing_request.customer_id,
        'username', existing_request.username_snapshot, 'already_prepared', true);
    end if;
    raise exception 'Customer account was not found' using errcode = 'P0002';
  end if;
  if target.role <> 'customer' then
    raise exception 'Only a customer account can be deleted' using errcode = '42501';
  end if;

  update public.orders set
    customer_name_snapshot = coalesce(nullif(btrim(customer_name_snapshot), ''), nullif(btrim(target.full_name), ''), target.username, 'Deleted customer'),
    customer_username_snapshot = coalesce(nullif(btrim(customer_username_snapshot), ''), target.username)
  where customer_id = target.id;
  get diagnostics order_count = row_count;

  delete from public.cart_items where customer_id = target.id;
  get diagnostics cart_count = row_count;
  update public.orders set customer_id = null where customer_id = target.id;

  insert into public.customer_deletion_requests(customer_id, username_snapshot, name_snapshot, requested_by,
    database_completed_at, auth_deleted_at, last_error_code, updated_at)
  values (target.id, target.username, target.full_name, auth.uid(), now(), null, null, now())
  on conflict (customer_id) do update set updated_at = now(), last_error_code = null;

  delete from public.profiles where id = target.id;
  insert into public.permanent_deletion_audit(actor_id, target_id, target_type, target_label, result, safe_metadata)
  values (auth.uid(), target.id, 'customer', target.username, 'database_detached',
    jsonb_build_object('preserved_orders', order_count, 'removed_cart_items', cart_count));

  return jsonb_build_object('customer_id', target.id, 'username', target.username,
    'preserved_orders', order_count, 'removed_cart_items', cart_count, 'already_prepared', false);
end;
$$;

create or replace function public.complete_customer_auth_deletion(
  p_customer_id uuid, p_success boolean, p_error_code text default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare request_row public.customer_deletion_requests%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service access is required' using errcode = '42501'; end if;
  select * into request_row from public.customer_deletion_requests where customer_id = p_customer_id for update;
  if not found then raise exception 'Customer deletion request was not found'; end if;
  update public.customer_deletion_requests set
    auth_deleted_at = case when p_success then coalesce(auth_deleted_at, now()) else auth_deleted_at end,
    last_error_code = case when p_success then null else coalesce(p_error_code, 'AUTH_DELETE_FAILED') end,
    updated_at = now()
  where customer_id = p_customer_id;
  insert into public.permanent_deletion_audit(actor_id, target_id, target_type, target_label, result, safe_metadata)
  values (request_row.requested_by, p_customer_id, 'customer', request_row.username_snapshot,
    case when p_success then 'auth_deleted' else 'auth_delete_failed' end,
    jsonb_strip_nulls(jsonb_build_object('error_code', p_error_code)));
end;
$$;

revoke all on function public.tombstone_product(uuid) from public;
revoke all on function public.prepare_customer_permanent_deletion(uuid) from public;
revoke all on function public.mark_product_image_cleanup(uuid, text, text) from public;
revoke all on function public.complete_customer_auth_deletion(uuid, boolean, text) from public;
grant execute on function public.tombstone_product(uuid) to authenticated;
grant execute on function public.prepare_customer_permanent_deletion(uuid) to authenticated;
grant execute on function public.mark_product_image_cleanup(uuid, text, text) to service_role;
grant execute on function public.complete_customer_auth_deletion(uuid, boolean, text) to service_role;

-- Product list/category contracts exclude tombstones. Tombstones have category_id NULL.
create or replace function public.list_managed_categories()
returns table (id uuid, name text, is_active boolean, product_count bigint)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_owner_or_staff() then raise exception 'Active owner or staff access is required' using errcode = '42501'; end if;
  return query select c.id, c.name, c.is_active, count(p.id)::bigint
  from public.categories c left join public.products p on p.category_id = c.id and p.deleted_at is null
  group by c.id, c.name, c.is_active order by lower(c.name), c.id;
end;
$$;

create or replace function public.delete_empty_category(p_category_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare current_product_count bigint;
begin
  if not public.is_owner_or_staff() then raise exception 'Active owner or staff access is required' using errcode = '42501'; end if;
  perform 1 from public.categories where id = p_category_id for update;
  if not found then raise exception 'Category was not found' using errcode = 'P0002'; end if;
  select count(*) into current_product_count from public.products where category_id = p_category_id and deleted_at is null;
  if current_product_count > 0 then raise exception 'Category is in use by % product(s)', current_product_count using errcode = '23503'; end if;
  delete from public.categories where id = p_category_id;
  return p_category_id;
exception when foreign_key_violation then raise exception 'Category is in use and cannot be deleted' using errcode = '23503';
end;
$$;

-- Checkout preserves customer/product display snapshots and rejects tombstones server-side.
create or replace function public.checkout_cart(
  p_idempotency_key uuid, p_phone text, p_delivery_address text, p_bus_station text default null,
  p_delivery_date date default null, p_customer_note text default null
)
returns table(order_id uuid, order_number text, total numeric)
language plpgsql security definer set search_path = public
as $$
declare created_order_id uuid; created_order_number text; calculated_total numeric; customer_profile public.profiles%rowtype;
begin
  perform public.require_active_customer();
  if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if nullif(btrim(p_phone), '') is null then raise exception 'Contact phone is required'; end if;
  if nullif(btrim(p_delivery_address), '') is null then raise exception 'Delivery address is required'; end if;
  select * into customer_profile from public.profiles where id = auth.uid() and role = 'customer' and is_active = true;

  select o.id, o.order_number, o.total into created_order_id, created_order_number, calculated_total
  from public.orders o where o.customer_id = auth.uid() and o.idempotency_key = p_idempotency_key;
  if found then return query select created_order_id, created_order_number, calculated_total; return; end if;

  perform 1 from public.cart_items where customer_id = auth.uid() for update;
  if not found then raise exception 'Cart is empty'; end if;
  if exists (select 1 from public.cart_items c left join public.products p on p.id = c.product_id
    where c.customer_id = auth.uid() and (p.id is null or not p.is_active or p.deleted_at is not null or c.quantity < p.minimum_order_quantity))
  then raise exception 'Cart contains a deleted/unavailable product or invalid quantity'; end if;

  select coalesce(sum(p.price * c.quantity), 0) into calculated_total
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.customer_id = auth.uid() and p.deleted_at is null;

  created_order_number := public.next_public_order_number();
  insert into public.orders(order_number, customer_id, customer_name_snapshot, customer_username_snapshot,
    status, delivery_address, bus_station, contact_phone, preferred_delivery_date, subtotal, total, customer_note, idempotency_key)
  values(created_order_number, auth.uid(), coalesce(nullif(btrim(customer_profile.full_name), ''), customer_profile.username),
    customer_profile.username, 'pending', btrim(p_delivery_address), nullif(btrim(p_bus_station), ''), btrim(p_phone),
    p_delivery_date, calculated_total, calculated_total, nullif(btrim(p_customer_note), ''), p_idempotency_key)
  returning id into created_order_id;

  insert into public.order_items(order_id, product_id, product_name, unit, unit_price, quantity, line_total)
  select created_order_id, p.id, p.name, p.unit, p.price, c.quantity, p.price * c.quantity
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.customer_id = auth.uid() and p.deleted_at is null order by c.created_at;
  delete from public.cart_items where customer_id = auth.uid();
  return query select created_order_id, created_order_number, calculated_total;
end;
$$;

-- Historical owner order search/rendering uses snapshots after profile deletion.
create or replace function public.list_owner_orders(
  p_group text default 'active', p_search text default '', p_offset integer default 0, p_limit integer default 20
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare safe_group text := case when p_group in ('active','ready','delivered','all') then p_group else 'all' end;
  safe_offset integer := greatest(coalesce(p_offset,0),0); safe_limit integer := least(greatest(coalesce(p_limit,20),1),100);
  search_pattern text := '%' || replace(replace(replace(btrim(coalesce(p_search,'')), '\', '\\'), '%', '\%'), '_', '\_') || '%'; result jsonb;
begin
  if not public.is_owner_or_staff() then raise exception 'Only active owner or staff can view owner orders' using errcode = '42501'; end if;
  with matching as (
    select o.* from public.orders o left join public.profiles p on p.id = o.customer_id
    where btrim(coalesce(p_search,'')) = '' or o.order_number ilike search_pattern escape '\'
      or coalesce(p.full_name,o.customer_name_snapshot,'') ilike search_pattern escape '\'
      or coalesce(p.username,o.customer_username_snapshot,'') ilike search_pattern escape '\'
  ), filtered as (
    select * from matching o where safe_group='all'
      or (safe_group='active' and o.status::text in ('pending','approved','processing'))
      or (safe_group='ready' and o.status::text='ready_to_ship') or (safe_group='delivered' and o.status::text='delivered')
  ), page as (select * from filtered order by created_at desc,id desc offset safe_offset limit safe_limit)
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object(
      'profiles',jsonb_build_object('full_name',coalesce((select p.full_name from public.profiles p where p.id=o.customer_id),o.customer_name_snapshot),
        'username',coalesce((select p.username from public.profiles p where p.id=o.customer_id),o.customer_username_snapshot)),
      'order_items',coalesce((select jsonb_agg(to_jsonb(oi) order by oi.id) from public.order_items oi where oi.order_id=o.id),'[]'::jsonb))
      order by o.created_at desc,o.id desc) from page o),'[]'::jsonb),
    'count',(select count(*) from filtered),
    'counts',jsonb_build_object('all',(select count(*) from matching),'pending',(select count(*) from matching where status::text='pending'),
      'active',(select count(*) from matching where status::text in ('pending','approved','processing')),
      'ready',(select count(*) from matching where status::text='ready_to_ship'),'delivered',(select count(*) from matching where status::text='delivered')),
    'delivered_revenue',coalesce((select sum(coalesce(confirmed_total,total)) from matching where status::text='delivered'),0),
    'customer_order_counts',coalesce((select jsonb_object_agg(customer_id::text,order_count) from
      (select customer_id,count(*) order_count from public.orders where customer_id is not null group by customer_id) x),'{}'::jsonb),
    'recent_rows',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
      'profiles',jsonb_build_object('full_name',coalesce((select p.full_name from public.profiles p where p.id=r.customer_id),r.customer_name_snapshot),
        'username',coalesce((select p.username from public.profiles p where p.id=r.customer_id),r.customer_username_snapshot)),
      'order_items',coalesce((select jsonb_agg(to_jsonb(oi) order by oi.id) from public.order_items oi where oi.order_id=r.id),'[]'::jsonb))
      order by r.created_at desc,r.id desc) from (select * from matching order by created_at desc,id desc limit 5) r),'[]'::jsonb)
  ) into result; return result;
end;
$$;

revoke all on function public.checkout_cart(uuid,text,text,text,date,text) from public;
revoke all on function public.list_owner_orders(text,text,integer,integer) from public;
grant execute on function public.checkout_cart(uuid,text,text,text,date,text) to authenticated;
grant execute on function public.list_owner_orders(text,text,integer,integer) to authenticated;

comment on function public.tombstone_product(uuid) is
  'Active-owner-only irreversible catalogue tombstone. Preserves order/inventory history and removes carts atomically.';
comment on function public.prepare_customer_permanent_deletion(uuid) is
  'Active owner/staff transaction: snapshot orders, remove cart, detach orders, and remove only a customer profile.';

-- Rollback notes:
-- 1. Restore the prior checkout/list/category functions before dropping new columns.
-- 2. Do not clear deleted_at or expose tombstoned rows: user-facing deletion is intentionally irreversible.
-- 3. Keep snapshot/audit columns and rows during rollback because historical vouchers depend on them.
-- 4. Auth deletion is external to PostgreSQL and cannot be rolled back by this migration.
