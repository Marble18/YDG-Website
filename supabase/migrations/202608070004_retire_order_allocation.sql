-- Retire stock allocation from ordering while retaining the legacy column for compatibility.
-- Historical allocation values and movements remain unchanged for audit purposes.

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
  if found then
    return query select created_order_id, created_order_number, calculated_total;
    return;
  end if;

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

  insert into public.order_items (order_id, product_id, product_name, unit, unit_price, quantity, line_total)
  select created_order_id, p.id, p.name, p.unit, p.price, c.quantity, p.price * c.quantity
  from public.cart_items c
  join public.products p on p.id = c.product_id
  where c.customer_id = auth.uid()
  order by c.created_at;

  delete from public.cart_items where customer_id = auth.uid();
  return query select created_order_id, created_order_number, calculated_total;
end;
$$;

drop function if exists public.confirm_order_item(uuid, integer, numeric, integer);
drop function if exists public.set_order_item_allocation(uuid, integer);

create or replace function public.confirm_order_item(
  p_order_item_id uuid,
  p_confirmed_quantity integer,
  p_confirmed_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner_or_staff() then
    raise exception 'Only active owner or staff can confirm order items' using errcode = '42501';
  end if;
  if p_confirmed_quantity is null or p_confirmed_quantity < 1 then
    raise exception 'Confirmed quantity must be a positive whole number';
  end if;
  if p_confirmed_unit_price is null or p_confirmed_unit_price < 0 then
    raise exception 'Confirmed unit price cannot be negative';
  end if;

  update public.order_items
  set confirmed_quantity = p_confirmed_quantity,
      confirmed_unit_price = p_confirmed_unit_price
  where id = p_order_item_id;
  if not found then raise exception 'Order item was not found'; end if;
end;
$$;

revoke all on function public.confirm_order_item(uuid, integer, numeric) from public;
grant execute on function public.confirm_order_item(uuid, integer, numeric) to authenticated;

comment on column public.order_items.allocated_quantity is
  'Deprecated compatibility field. Ordering and confirmation do not allocate stock; new rows remain 0.';

-- Rollback: restore the prior checkout_cart and four-argument confirmation functions from
-- migrations 202608070001-003. The retained column makes that rollback schema-compatible.
