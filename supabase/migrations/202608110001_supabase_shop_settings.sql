-- PR #16: make shop/voucher settings device-independent Supabase sources of truth.

alter table public.app_settings
  add column if not exists backup_frequency text not null default 'Weekly',
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.app_settings drop constraint if exists app_settings_backup_frequency_check;
alter table public.app_settings
  add constraint app_settings_backup_frequency_check
  check (backup_frequency in ('Daily', 'Weekly', 'Monthly')) not valid;
alter table public.app_settings validate constraint app_settings_backup_frequency_check;

alter table public.voucher_settings
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.voucher_settings drop constraint if exists voucher_settings_title_length_check;
alter table public.voucher_settings drop constraint if exists voucher_settings_footer_length_check;
alter table public.voucher_settings drop constraint if exists voucher_settings_color_check;
alter table public.voucher_settings
  add constraint voucher_settings_title_length_check check (char_length(btrim(title)) between 1 and 80) not valid,
  add constraint voucher_settings_footer_length_check check (char_length(btrim(footer_text)) between 1 and 240) not valid,
  add constraint voucher_settings_color_check check (color ~ '^#[0-9A-Fa-f]{6}$') not valid;
alter table public.voucher_settings validate constraint voucher_settings_title_length_check;
alter table public.voucher_settings validate constraint voucher_settings_footer_length_check;
alter table public.voucher_settings validate constraint voucher_settings_color_check;

insert into public.app_settings (id, maintenance_mode, backup_frequency)
values (1, false, 'Weekly')
on conflict (id) do nothing;

insert into public.voucher_settings (id, title, color, footer_text)
values (
  1,
  'Delivery Voucher',
  '#D96C91',
  'Thank you for shopping with Yadanar Theingi Stationery & Fancy.'
)
on conflict (id) do nothing;

-- Upgrade only the untouched original seed values; preserve real owner customizations.
update public.voucher_settings
set title = 'Delivery Voucher',
    color = '#D96C91',
    footer_text = 'Thank you for shopping with Yadanar Theingi Stationery & Fancy.',
    updated_at = now()
where id = 1
  and title = 'Yadanar Theingi Stationery & Fancy'
  and lower(color) = '#2563eb'
  and footer_text = 'Thank you for your order.';

alter table public.app_settings enable row level security;
alter table public.voucher_settings enable row level security;

do $$
declare policy_record record;
begin
  for policy_record in
    select cls.relname, pol.polname
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    where ns.nspname = 'public' and cls.relname in ('app_settings', 'voucher_settings')
  loop
    execute format('drop policy if exists %I on public.%I', policy_record.polname, policy_record.relname);
  end loop;
end $$;

create policy pr16_app_settings_public_read on public.app_settings
for select to anon, authenticated using (id = 1);
create policy pr16_voucher_settings_public_read on public.voucher_settings
for select to anon, authenticated using (id = 1);

revoke all on public.app_settings from anon, authenticated;
revoke all on public.voucher_settings from anon, authenticated;
grant select (id, maintenance_mode, backup_frequency, updated_at)
  on public.app_settings to anon, authenticated;
grant select (id, title, color, footer_text, updated_at)
  on public.voucher_settings to anon, authenticated;

create or replace function public.update_site_settings(
  p_maintenance_mode boolean,
  p_backup_frequency text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_manager() then
    raise exception 'Active owner access is required' using errcode = '42501';
  end if;
  if p_backup_frequency not in ('Daily', 'Weekly', 'Monthly') then
    raise exception 'Invalid backup frequency';
  end if;
  update public.app_settings
  set maintenance_mode = coalesce(p_maintenance_mode, false),
      backup_frequency = p_backup_frequency,
      updated_by = auth.uid(),
      updated_at = now()
  where id = 1;
  if not found then raise exception 'Site settings row is missing'; end if;
end;
$$;

create or replace function public.update_voucher_settings(
  p_title text,
  p_color text,
  p_footer_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_title text := btrim(coalesce(p_title, ''));
  safe_footer text := btrim(coalesce(p_footer_text, ''));
begin
  if not public.is_active_manager() then
    raise exception 'Active owner access is required' using errcode = '42501';
  end if;
  if char_length(safe_title) not between 1 and 80 then
    raise exception 'Voucher title must be 1 to 80 characters';
  end if;
  if p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Voucher colour must be a six-digit hex value';
  end if;
  if char_length(safe_footer) not between 1 and 240 then
    raise exception 'Voucher footer must be 1 to 240 characters';
  end if;
  update public.voucher_settings
  set title = safe_title,
      color = upper(p_color),
      footer_text = safe_footer,
      updated_by = auth.uid(),
      updated_at = now()
  where id = 1;
  if not found then raise exception 'Voucher settings row is missing'; end if;
end;
$$;

revoke all on function public.update_site_settings(boolean, text) from public;
revoke all on function public.update_voucher_settings(text, text, text) from public;
grant execute on function public.update_site_settings(boolean, text) to authenticated;
grant execute on function public.update_voucher_settings(text, text, text) to authenticated;

create or replace function public.enforce_customer_maintenance_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.app_settings where id = 1 and maintenance_mode = true
  ) and exists (
    select 1 from public.profiles
    where id = auth.uid() and role::text = 'customer' and is_active = true
  ) then
    raise exception 'Customer ordering is temporarily under maintenance' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists pr16_cart_maintenance_guard on public.cart_items;
create trigger pr16_cart_maintenance_guard
before insert or update or delete on public.cart_items
for each row execute function public.enforce_customer_maintenance_mode();

drop trigger if exists pr16_order_maintenance_guard on public.orders;
create trigger pr16_order_maintenance_guard
before insert on public.orders
for each row execute function public.enforce_customer_maintenance_mode();

revoke all on function public.enforce_customer_maintenance_mode() from public;

comment on function public.update_site_settings(boolean, text) is
  'Active-owner-only site setting update; direct browser table writes remain revoked.';
comment on function public.update_voucher_settings(text, text, text) is
  'Active-owner-only validated voucher setting update; direct browser table writes remain revoked.';

-- Rollback: drop the two pr16_* triggers and their guard function, revoke/drop the
-- two update RPCs, restore the prior read/write policies if required, then remove
-- backup_frequency/updated_by only after the frontend no longer depends on them.
