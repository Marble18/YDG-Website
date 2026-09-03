-- PR #20 backup compatibility: old backups cannot re-create a permanently deleted identity.

create or replace function public.business_restore_table_preview(p_table text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare filtered_rows jsonb := coalesce(p_rows, '[]'::jsonb);
declare total_count integer;
declare original_count integer := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
declare existing_count integer := 0;
begin
  if p_table not in ('categories','products','profiles','orders','order_items','cart_items',
    'inventory_movements','voucher_settings','app_settings','delivery_proofs') then raise exception 'Unsupported restore table'; end if;
  if p_table = 'profiles' then
    select coalesce(jsonb_agg(value), '[]'::jsonb) into filtered_rows from jsonb_array_elements(filtered_rows)
    where not exists (select 1 from public.customer_deletion_requests d where d.customer_id::text = value->>'id')
      and exists (select 1 from auth.users u where u.id::text = value->>'id');
  elsif p_table = 'products' then
    select coalesce(jsonb_agg(value), '[]'::jsonb) into filtered_rows from jsonb_array_elements(filtered_rows)
    where not exists (select 1 from public.products p where p.id::text = value->>'id' and p.deleted_at is not null);
  end if;
  total_count := jsonb_array_length(filtered_rows);
  if total_count > 0 then execute format(
    'select count(*) from public.%I t where t.id::text in (select value->>''id'' from jsonb_array_elements($1))', p_table
  ) into existing_count using filtered_rows; end if;
  return jsonb_build_object('incoming', original_count, 'insert', total_count - existing_count,
    'update', existing_count, 'skip', original_count - total_count, 'conflict', 0);
end;
$$;

create or replace function public.business_restore_upsert(p_table text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare filtered_rows jsonb := coalesce(p_rows, '[]'::jsonb); column_list text; update_list text; affected_count integer := 0;
begin
  if p_table not in ('categories','products','profiles','orders','order_items','cart_items',
    'inventory_movements','voucher_settings','app_settings','delivery_proofs') then raise exception 'Unsupported restore table'; end if;
  if p_table = 'profiles' then
    select coalesce(jsonb_agg(value), '[]'::jsonb) into filtered_rows from jsonb_array_elements(filtered_rows)
    where not exists (select 1 from public.customer_deletion_requests d where d.customer_id::text = value->>'id')
      and exists (select 1 from auth.users u where u.id::text = value->>'id');
  elsif p_table = 'products' then
    select coalesce(jsonb_agg(value), '[]'::jsonb) into filtered_rows from jsonb_array_elements(filtered_rows)
    where not exists (select 1 from public.products p where p.id::text = value->>'id' and p.deleted_at is not null);
  end if;
  if jsonb_array_length(filtered_rows) = 0 then return 0; end if;
  select string_agg(quote_ident(attname), ', ' order by attnum),
    string_agg(format('%1$I = excluded.%1$I', attname), ', ' order by attnum) filter (where attname <> 'id')
  into column_list, update_list from pg_attribute
  where attrelid = format('public.%I', p_table)::regclass and attnum > 0 and not attisdropped and attgenerated = '' and attidentity = '';
  execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (id) do update set %3$s',
    p_table, column_list, update_list) using filtered_rows;
  get diagnostics affected_count = row_count; return affected_count;
end;
$$;

do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.preview_business_restore(jsonb,text)'::regprocedure);
  execute replace(definition, '202608110002', '202609020001');
  definition := pg_get_functiondef('public.restore_business_backup(uuid,jsonb,text)'::regprocedure);
  execute replace(definition, '202608110002', '202609020001');
end $$;

revoke all on function public.business_restore_table_preview(text, jsonb) from public;
revoke all on function public.business_restore_upsert(text, jsonb) from public;

-- Rollback: restore the prior helpers and schema-version checks. Keep deletion request
-- records so an older backup can never silently revive an intentionally deleted account.
