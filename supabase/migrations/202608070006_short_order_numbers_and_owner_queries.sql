-- Short public order numbers, protected status transitions and paged owner queries.

create table if not exists public.order_number_counters (
  order_date date primary key,
  last_value integer not null check (last_value between 0 and 9999),
  updated_at timestamptz not null default now()
);

revoke all on public.order_number_counters from public, anon, authenticated;

do $$
declare order_record record;
begin
  for order_record in
    select id,
      'YT-' || to_char(local_date, 'YYMMDD') || '-' || lpad(daily_number::text, 4, '0') short_number
    from (
      select id,
        (created_at at time zone 'Asia/Yangon')::date local_date,
        row_number() over (
          partition by (created_at at time zone 'Asia/Yangon')::date
          order by created_at, id
        ) daily_number
      from public.orders
    ) ranked
  loop
    update public.orders set order_number = order_record.short_number where id = order_record.id;
  end loop;
end $$;

insert into public.order_number_counters (order_date, last_value)
select (created_at at time zone 'Asia/Yangon')::date, count(*)::integer
from public.orders
group by (created_at at time zone 'Asia/Yangon')::date
on conflict (order_date) do update
set last_value = greatest(public.order_number_counters.last_value, excluded.last_value),
    updated_at = now();

alter table public.orders alter column order_number set not null;
create unique index if not exists orders_order_number_unique on public.orders (order_number);
create index if not exists orders_status_created_id_idx on public.orders (status, created_at desc, id desc);
create index if not exists orders_created_id_idx on public.orders (created_at desc, id desc);
create index if not exists orders_order_number_lower_idx on public.orders (lower(order_number));

create or replace function public.next_public_order_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  yangon_date date := (clock_timestamp() at time zone 'Asia/Yangon')::date;
  next_value integer;
begin
  insert into public.order_number_counters (order_date, last_value)
  values (yangon_date, 1)
  on conflict (order_date) do update
  set last_value = public.order_number_counters.last_value + 1,
      updated_at = now()
  returning last_value into next_value;

  if next_value > 9999 then raise exception 'Daily order number limit was reached'; end if;
  return 'YT-' || to_char(yangon_date, 'YYMMDD') || '-' || lpad(next_value::text, 4, '0');
end;
$$;

revoke all on function public.next_public_order_number() from public;

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

  select coalesce(sum(p.price * c.quantity), 0) into calculated_total
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.customer_id = auth.uid();

  created_order_number := public.next_public_order_number();
  insert into public.orders (order_number, customer_id, status, delivery_address, bus_station,
    contact_phone, preferred_delivery_date, subtotal, total, customer_note, idempotency_key)
  values (created_order_number, auth.uid(), 'pending', btrim(p_delivery_address), nullif(btrim(p_bus_station), ''),
    btrim(p_phone), p_delivery_date, calculated_total, calculated_total, nullif(btrim(p_customer_note), ''), p_idempotency_key)
  returning id into created_order_id;

  insert into public.order_items (order_id, product_id, product_name, unit, unit_price, quantity, line_total)
  select created_order_id, p.id, p.name, p.unit, p.price, c.quantity, p.price * c.quantity
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.customer_id = auth.uid() order by c.created_at;

  delete from public.cart_items where customer_id = auth.uid();
  return query select created_order_id, created_order_number, calculated_total;
end;
$$;

revoke all on function public.checkout_cart(uuid, text, text, text, date, text) from public;
grant execute on function public.checkout_cart(uuid, text, text, text, date, text) to authenticated;

create or replace function public.update_order_status(p_order_id uuid, p_new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare current_status text;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'owner' and is_active = true
  ) then raise exception 'Only an active owner can update order status' using errcode = '42501'; end if;

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
revoke insert, update, delete on public.orders from authenticated;
grant select on public.orders to authenticated;

create or replace function public.list_owner_orders(
  p_group text default 'active',
  p_search text default '',
  p_offset integer default 0,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_group text := case when p_group in ('active', 'ready', 'delivered', 'all') then p_group else 'all' end;
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  search_pattern text := '%' || replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  result jsonb;
begin
  if not public.is_owner_or_staff() then
    raise exception 'Only active owner or staff can view owner orders' using errcode = '42501';
  end if;

  with matching as (
    select o.*
    from public.orders o
    left join public.profiles p on p.id = o.customer_id
    where btrim(coalesce(p_search, '')) = ''
      or o.order_number ilike search_pattern escape '\'
      or coalesce(p.full_name, '') ilike search_pattern escape '\'
      or coalesce(p.username, '') ilike search_pattern escape '\'
  ), filtered as (
    select * from matching o
    where safe_group = 'all'
      or (safe_group = 'active' and o.status::text in ('pending','approved','processing'))
      or (safe_group = 'ready' and o.status::text = 'ready_to_ship')
      or (safe_group = 'delivered' and o.status::text = 'delivered')
  ), page as (
    select * from filtered order by created_at desc, id desc offset safe_offset limit safe_limit
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(
      to_jsonb(o) || jsonb_build_object(
        'profiles', (select jsonb_build_object('full_name', p.full_name, 'username', p.username) from public.profiles p where p.id = o.customer_id),
        'order_items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.id) from public.order_items oi where oi.order_id = o.id), '[]'::jsonb)
      ) order by o.created_at desc, o.id desc
    ) from page o), '[]'::jsonb),
    'count', (select count(*) from filtered),
    'counts', jsonb_build_object(
      'all', (select count(*) from matching),
      'pending', (select count(*) from matching where status::text = 'pending'),
      'active', (select count(*) from matching where status::text in ('pending','approved','processing')),
      'ready', (select count(*) from matching where status::text = 'ready_to_ship'),
      'delivered', (select count(*) from matching where status::text = 'delivered')
    ),
    'delivered_revenue', coalesce((select sum(coalesce(confirmed_total, total)) from matching where status::text = 'delivered'), 0),
    'customer_order_counts', coalesce((select jsonb_object_agg(customer_id::text, order_count) from (
      select customer_id, count(*) order_count from public.orders group by customer_id
    ) customer_totals), '{}'::jsonb),
    'recent_rows', coalesce((select jsonb_agg(
      to_jsonb(r) || jsonb_build_object(
        'profiles', (select jsonb_build_object('full_name', p.full_name, 'username', p.username) from public.profiles p where p.id = r.customer_id),
        'order_items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.id) from public.order_items oi where oi.order_id = r.id), '[]'::jsonb)
      ) order by r.created_at desc, r.id desc
    ) from (select * from matching order by created_at desc, id desc limit 5) r), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.list_owner_orders(text, text, integer, integer) from public;
grant execute on function public.list_owner_orders(text, text, integer, integer) to authenticated;

-- Rollback retains the backfilled public numbers. Restore the prior checkout/status/list
-- functions only after confirming no new short-number orders depend on this counter.
