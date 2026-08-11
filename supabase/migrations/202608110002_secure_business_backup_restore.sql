-- PR #17: primary-owner-only, merge-mode business backup restore contracts.

create table if not exists public.business_restore_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  backup_checksum text not null check (backup_checksum ~ '^[0-9a-f]{64}$'),
  backup_type text not null default 'database' check (backup_type in ('database', 'storage')),
  preview jsonb not null,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists business_restore_plans_owner_expiry_idx
  on public.business_restore_plans (owner_id, expires_at desc);

create table if not exists public.business_restore_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  backup_checksum text not null check (backup_checksum ~ '^[0-9a-f]{64}$'),
  backup_type text not null check (backup_type in ('database', 'storage')),
  format_version text not null,
  result_summary jsonb not null,
  restored_at timestamptz not null default now(),
  unique (backup_checksum, backup_type)
);

alter table public.business_restore_plans enable row level security;
alter table public.business_restore_audit enable row level security;
revoke all on public.business_restore_plans, public.business_restore_audit from anon, authenticated;
grant select on public.business_restore_audit to authenticated;

drop policy if exists pr17_restore_audit_primary_owner_read on public.business_restore_audit;
create policy pr17_restore_audit_primary_owner_read on public.business_restore_audit
for select to authenticated using (public.is_active_manager() and owner_id = auth.uid());

create or replace function public.is_primary_owner(check_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select check_user_id is not null and check_user_id = (
    select id from public.profiles
    where role::text = 'owner' and is_active = true
    order by created_at asc, id asc limit 1
  )
$$;
revoke all on function public.is_primary_owner(uuid) from public;
grant execute on function public.is_primary_owner(uuid) to authenticated, service_role;

create or replace function public.business_restore_table_preview(p_table text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare total_count integer := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
declare existing_count integer := 0;
begin
  if p_table not in ('categories','products','profiles','orders','order_items','cart_items',
    'inventory_movements','voucher_settings','app_settings','delivery_proofs') then
    raise exception 'Unsupported restore table';
  end if;
  if total_count > 0 then
    execute format(
      'select count(*) from public.%I t where t.id::text in (select value->>''id'' from jsonb_array_elements($1))',
      p_table
    ) into existing_count using p_rows;
  end if;
  return jsonb_build_object('incoming', total_count, 'insert', total_count - existing_count,
    'update', existing_count, 'skip', 0, 'conflict', 0);
end;
$$;
revoke all on function public.business_restore_table_preview(text, jsonb) from public;

create or replace function public.preview_business_restore(p_payload jsonb, p_checksum text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare table_name text;
declare summary jsonb := '{}'::jsonb;
declare plan_id uuid;
declare rows jsonb;
begin
  if not public.is_primary_owner() then
    raise exception 'Active primary owner access is required' using errcode = '42501';
  end if;
  if p_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Invalid backup checksum'; end if;
  if p_payload->'metadata'->>'formatVersion' <> 'ydg-business-backup-v1' then
    raise exception 'Unsupported backup format version';
  end if;
  if p_payload->'metadata'->>'schemaVersion' <> '202608110002' then
    raise exception 'Backup schema version is incompatible';
  end if;
  if jsonb_typeof(p_payload->'data') <> 'object' then raise exception 'Backup data is missing'; end if;

  foreach table_name in array array['categories','products','profiles','orders','order_items',
    'cart_items','inventory_movements','voucher_settings','app_settings','delivery_proofs']
  loop
    rows := coalesce(p_payload->'data'->table_name, '[]'::jsonb);
    if jsonb_typeof(rows) <> 'array' then raise exception 'Invalid % backup data', table_name; end if;
    if table_name = 'profiles' then
      select coalesce(jsonb_agg(value), '[]'::jsonb) into rows
      from jsonb_array_elements(rows) where value->>'id' is distinct from auth.uid()::text;
    end if;
    summary := summary || jsonb_build_object(table_name, public.business_restore_table_preview(table_name, rows));
  end loop;

  delete from public.business_restore_plans where expires_at < now() or consumed_at is not null;
  insert into public.business_restore_plans(owner_id, backup_checksum, backup_type, preview)
  values(auth.uid(), p_checksum, 'database', summary) returning id into plan_id;
  return jsonb_build_object('planId', plan_id, 'expiresInSeconds', 900, 'tables', summary,
    'mode', 'merge', 'primaryOwnerProtected', true);
end;
$$;

create or replace function public.business_restore_upsert(p_table text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare column_list text;
declare update_list text;
declare affected_count integer := 0;
begin
  if p_table not in ('categories','products','profiles','orders','order_items','cart_items',
    'inventory_movements','voucher_settings','app_settings','delivery_proofs') then
    raise exception 'Unsupported restore table';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then return 0; end if;
  select string_agg(quote_ident(attname), ', ' order by attnum),
         string_agg(format('%1$I = excluded.%1$I', attname), ', ' order by attnum)
           filter (where attname <> 'id')
  into column_list, update_list
  from pg_attribute
  where attrelid = format('public.%I', p_table)::regclass
    and attnum > 0 and not attisdropped and attgenerated = '' and attidentity = '';
  execute format(
    'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) '
    'on conflict (id) do update set %3$s', p_table, column_list, update_list
  ) using p_rows;
  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;
revoke all on function public.business_restore_upsert(text, jsonb) from public;

create or replace function public.restore_business_backup(
  p_plan_id uuid, p_payload jsonb, p_checksum text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare restore_plan public.business_restore_plans%rowtype;
declare table_name text;
declare rows jsonb;
declare summary jsonb := '{}'::jsonb;
declare affected integer;
declare existing_audit jsonb;
begin
  if not public.is_primary_owner() then
    raise exception 'Active primary owner access is required' using errcode = '42501';
  end if;
  select * into restore_plan from public.business_restore_plans
  where id = p_plan_id and owner_id = auth.uid() for update;
  if not found or restore_plan.expires_at < now() or restore_plan.consumed_at is not null then
    raise exception 'Restore preview expired or was already used';
  end if;
  if restore_plan.backup_checksum <> p_checksum then raise exception 'Restore checksum does not match preview'; end if;
  if p_payload->'metadata'->>'formatVersion' <> 'ydg-business-backup-v1'
     or p_payload->'metadata'->>'schemaVersion' <> '202608110002' then
    raise exception 'Backup format is incompatible';
  end if;
  select result_summary into existing_audit from public.business_restore_audit
  where backup_checksum = p_checksum and backup_type = 'database';
  if found then
    update public.business_restore_plans set consumed_at = now() where id = p_plan_id;
    return jsonb_build_object('alreadyRestored', true, 'tables', existing_audit);
  end if;

  perform pg_advisory_xact_lock(hashtext('ydg-business-restore'));
  foreach table_name in array array['profiles','categories','products','orders','order_items',
    'cart_items','inventory_movements','voucher_settings','app_settings','delivery_proofs']
  loop
    rows := coalesce(p_payload->'data'->table_name, '[]'::jsonb);
    if table_name = 'profiles' then
      select coalesce(jsonb_agg(value), '[]'::jsonb) into rows
      from jsonb_array_elements(rows) where value->>'id' is distinct from auth.uid()::text;
    end if;
    affected := public.business_restore_upsert(table_name, rows);
    summary := summary || jsonb_build_object(table_name, jsonb_build_object('affected', affected));
  end loop;
  update public.business_restore_plans set consumed_at = now() where id = p_plan_id;
  insert into public.business_restore_audit(owner_id, backup_checksum, backup_type, format_version, result_summary)
  values(auth.uid(), p_checksum, 'database', 'ydg-business-backup-v1', summary);
  return jsonb_build_object('alreadyRestored', false, 'tables', summary);
end;
$$;

revoke all on function public.preview_business_restore(jsonb, text) from public;
revoke all on function public.restore_business_backup(uuid, jsonb, text) from public;
grant execute on function public.preview_business_restore(jsonb, text) to authenticated;
grant execute on function public.restore_business_backup(uuid, jsonb, text) to authenticated;

comment on function public.restore_business_backup(uuid, jsonb, text) is
  'Primary-owner-only atomic merge restore. The caller profile is always excluded and no rows are deleted.';

-- Rollback: disable the backup UI/Edge Function first, then revoke/drop the restore
-- RPCs and helpers. Retain business_restore_audit for operational history. Dropping
-- plans is safe after all plans expire; this migration never deletes business data.
