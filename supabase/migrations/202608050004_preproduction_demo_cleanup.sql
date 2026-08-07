-- Confirmed pre-production cleanup. Targets only the audited 2026-08-05 demo UUIDs.
-- Storage object bytes are removed separately with exact paths after this transaction succeeds.

do $$
declare
  protected_owner_id constant uuid := '65f629cb-4f13-482d-86d3-514531333c7f';
  demo_customer_id constant uuid := 'a31af45a-131d-4e29-a9d9-33edb344b850';
  demo_product_ids constant uuid[] := array[
    'a577f0fb-81d6-422d-a3d9-09c1ea1c24ce',
    'a6c0e967-f235-4b7c-ab68-cb987339abc2',
    'b1480d02-bbe0-4a17-a7dc-bf9130f9edc4',
    '7e0c90ea-6a5d-436d-b0be-bd9bbbfa1e9b',
    '56dfeae0-fbc8-4072-8384-bd441fcd7587',
    '640a0f78-fe73-4dd1-88cb-286294db6e32',
    '402bddd7-538a-4838-9c3d-f8ab554906c0',
    '65a30598-2922-4c29-b217-749963a5e640',
    '7305586b-e583-45ea-bd98-6c4f5dddd63e',
    '92c15aeb-e5ac-454d-91a9-662b1d7d95c3',
    '98a3701a-7c97-4ab0-924f-dc6aaa1a68e8',
    'b773ca06-3b0e-49dd-b80a-1be7e6471bd8',
    '53364554-9ede-4c0b-b3cf-62c76e3bc65c',
    'a1982548-92c0-49a5-a74f-21cf2ed8ca56',
    '705e63ce-17a6-4960-b405-c2cf6287e12d',
    '4677993b-5524-48d3-93f1-d0b1b98dbeb7',
    '165cd9ba-601c-493e-ac99-ce2eb70b92cc',
    'c8200399-ece7-4338-8411-2eb50700ce8f',
    '8271d2c6-60c2-4c59-89a3-c4ce913789e2',
    'e1031589-aaf9-4329-9217-c34c80c13c64',
    'c6e66df7-8cd5-48bc-85ea-de12452af7a1',
    '303ab17c-7feb-4e75-88e2-8ed9f66126ab'
  ]::uuid[];
  demo_category_ids constant uuid[] := array[
    'fb648be5-cabe-4488-b269-27a1cbea3f7c',
    '88cc2755-1527-4b73-8856-8b7effd72efb',
    '7e5aa730-72c5-49a4-a148-32d17e73cf8f',
    '0042b2c2-451e-41aa-a768-55e2548aacd5',
    '67376a36-b94e-472c-a1a9-8abcfcd7e5b4',
    'e09eac56-3d6f-4cdb-a41a-cabb0a3a14ff',
    '6c7a42ff-f402-4f00-9603-c9fb4d6d7e72',
    'd871b824-0424-48ef-9c86-cfbab5d27010'
  ]::uuid[];
begin
  if demo_customer_id = protected_owner_id then
    raise exception 'Cleanup target matches the protected owner ID';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = protected_owner_id
      and lower(username) = 'owner'
      and role = 'owner'
      and is_active = true
  ) then
    raise exception 'Protected active owner profile was not found; cleanup aborted';
  end if;

  if exists (select 1 from public.products where not (id = any(demo_product_ids))) then
    raise exception 'Unreviewed product rows exist; cleanup aborted';
  end if;

  if exists (select 1 from public.categories where not (id = any(demo_category_ids))) then
    raise exception 'Unreviewed category rows exist; cleanup aborted';
  end if;

  if exists (
    select 1 from public.profiles
    where id = demo_customer_id
      and (lower(username) <> 'test1' or role <> 'customer')
  ) then
    raise exception 'Demo customer identity no longer matches the audit; cleanup aborted';
  end if;

  delete from public.cart_items
  where customer_id = demo_customer_id or product_id = any(demo_product_ids);

  delete from public.order_items
  where product_id = any(demo_product_ids)
     or order_id in (select id from public.orders where customer_id = demo_customer_id);

  delete from public.inventory_movements
  where product_id = any(demo_product_ids)
     or order_id in (select id from public.orders where customer_id = demo_customer_id);

  delete from public.orders where customer_id = demo_customer_id;
  delete from public.products where id = any(demo_product_ids);

  delete from public.categories c
  where c.id = any(demo_category_ids)
    and not exists (select 1 from public.products p where p.category_id = c.id);

  delete from auth.users u
  where u.id = demo_customer_id
    and u.id <> protected_owner_id
    and exists (
      select 1 from public.profiles p
      where p.id = u.id and lower(p.username) = 'test1' and p.role = 'customer'
    );

  if not exists (
    select 1 from public.profiles
    where id = protected_owner_id and role = 'owner' and is_active = true
  ) then
    raise exception 'Protected owner validation failed; cleanup rolled back';
  end if;
end;
$$;
