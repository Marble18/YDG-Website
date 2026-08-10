-- PR #14: private, authorization-scoped delivery proof metadata and Storage access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'delivery-proofs', 'delivery-proofs', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.delivery_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  bucket_id text not null default 'delivery-proofs' check (bucket_id = 'delivery-proofs'),
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size bigint not null check (file_size > 0 and file_size <= 5242880),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 500)
);

create index if not exists delivery_proofs_uploaded_by_idx
  on public.delivery_proofs (uploaded_by);

alter table public.delivery_proofs enable row level security;
revoke all on public.delivery_proofs from anon, authenticated;
grant select on public.delivery_proofs to authenticated;

drop policy if exists pr14_delivery_proofs_read on public.delivery_proofs;
create policy pr14_delivery_proofs_read on public.delivery_proofs
for select to authenticated
using (
  public.is_owner_or_staff()
  or (
    public.is_active_account()
    and exists (
      select 1 from public.orders o
      where o.id = delivery_proofs.order_id and o.customer_id = auth.uid()
    )
  )
);

create or replace function public.save_delivery_proof(
  p_order_id uuid,
  p_object_path text,
  p_mime_type text,
  p_file_size bigint,
  p_note text default null,
  p_mark_delivered boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  current_status text;
  previous_path text;
  expected_extension text;
  stored_mime text;
  stored_size bigint;
  proof_id uuid;
begin
  if not public.is_owner_or_staff() then
    raise exception 'Active owner or staff access is required' using errcode = '42501';
  end if;
  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Proof must be JPEG, PNG or WebP';
  end if;
  if p_file_size is null or p_file_size < 1 or p_file_size > 5242880 then
    raise exception 'Proof file must be 5 MB or smaller';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'Proof note must be 500 characters or fewer';
  end if;

  expected_extension := case p_mime_type
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
  if p_object_path !~ ('^orders/' || p_order_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.' || expected_extension || '$') then
    raise exception 'Invalid delivery proof object path';
  end if;

  select status::text into current_status
  from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order was not found'; end if;
  if p_mark_delivered then
    if current_status = 'ready_to_ship' then
      update public.orders set status = 'delivered', updated_at = now() where id = p_order_id;
    elsif current_status <> 'delivered' then
      raise exception 'Only a Ready to Ship order can be marked Delivered';
    end if;
  elsif current_status <> 'delivered' then
    raise exception 'A proof can be attached only to a Delivered order';
  end if;

  select metadata->>'mimetype', nullif(metadata->>'size', '')::bigint
    into stored_mime, stored_size
  from storage.objects
  where bucket_id = 'delivery-proofs' and name = p_object_path;
  if not found then raise exception 'Uploaded proof object was not found'; end if;
  if stored_mime is distinct from p_mime_type or stored_size is distinct from p_file_size then
    raise exception 'Uploaded proof metadata does not match the file';
  end if;

  select object_path into previous_path
  from public.delivery_proofs where order_id = p_order_id for update;

  insert into public.delivery_proofs (
    order_id, bucket_id, object_path, mime_type, file_size, uploaded_by, uploaded_at, note
  ) values (
    p_order_id, 'delivery-proofs', p_object_path, p_mime_type, p_file_size, auth.uid(), now(), nullif(btrim(p_note), '')
  )
  on conflict (order_id) do update set
    object_path = excluded.object_path,
    mime_type = excluded.mime_type,
    file_size = excluded.file_size,
    uploaded_by = excluded.uploaded_by,
    uploaded_at = excluded.uploaded_at,
    note = excluded.note
  returning id into proof_id;

  return jsonb_build_object(
    'id', proof_id,
    'previous_object_path', previous_path,
    'replaced', previous_path is not null and previous_path <> p_object_path
  );
end;
$$;

revoke all on function public.save_delivery_proof(uuid, text, text, bigint, text, boolean) from public;
grant execute on function public.save_delivery_proof(uuid, text, text, bigint, text, boolean) to authenticated;

create or replace function public.remove_delivery_proof(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare removed_path text;
begin
  if not public.is_owner_or_staff() then
    raise exception 'Active owner or staff access is required' using errcode = '42501';
  end if;
  delete from public.delivery_proofs
  where order_id = p_order_id
  returning object_path into removed_path;
  return removed_path;
end;
$$;

revoke all on function public.remove_delivery_proof(uuid) from public;
grant execute on function public.remove_delivery_proof(uuid) to authenticated;

drop policy if exists pr14_delivery_proof_objects_read on storage.objects;
create policy pr14_delivery_proof_objects_read on storage.objects
for select to authenticated
using (
  bucket_id = 'delivery-proofs'
  and exists (
    select 1
    from public.delivery_proofs dp
    join public.orders o on o.id = dp.order_id
    where dp.bucket_id = storage.objects.bucket_id
      and dp.object_path = storage.objects.name
      and (
        public.is_owner_or_staff()
        or (public.is_active_account() and o.customer_id = auth.uid())
      )
  )
);

drop policy if exists pr14_delivery_proof_objects_insert on storage.objects;
create policy pr14_delivery_proof_objects_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'delivery-proofs'
  and public.is_owner_or_staff()
  and name ~ '^orders/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
  and exists (
    select 1 from public.orders o
    where o.id = ((storage.foldername(name))[2])::uuid
  )
);

drop policy if exists pr14_delivery_proof_objects_delete on storage.objects;
create policy pr14_delivery_proof_objects_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'delivery-proofs'
  and public.is_owner_or_staff()
  and name ~ '^orders/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
);

comment on table public.delivery_proofs is
  'Private current delivery proof metadata. Signed URLs are generated on demand and never persisted.';
comment on function public.save_delivery_proof(uuid, text, text, bigint, text, boolean) is
  'Atomically validates proof metadata, replaces the current proof pointer, and optionally marks a Ready to Ship order Delivered.';

-- Rollback: remove the pr14_* storage/object and table policies, revoke/drop the
-- two RPCs, then drop public.delivery_proofs. Keep the delivery-proofs bucket
-- private; remove objects only by reviewed exact paths before dropping the bucket.
