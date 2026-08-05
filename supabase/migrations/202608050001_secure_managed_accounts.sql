-- Username-based, owner-managed account foundation.
-- Edge Functions use a secret key; browsers receive no privileged credentials.

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username))
  where username is not null;

alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$')
  not valid;

alter table public.profiles validate constraint profiles_username_format;

create or replace function public.is_active_manager(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user_id
      and role::text = 'owner'
      and is_active = true
  );
$$;

revoke all on function public.is_active_manager(uuid) from public;
grant execute on function public.is_active_manager(uuid) to authenticated, service_role;

alter table public.profiles enable row level security;

do $$
declare policy_name text;
begin
  for policy_name in
    select pol.polname
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    where ns.nspname = 'public' and cls.relname = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', policy_name);
  end loop;
end $$;

create policy profiles_read_self_or_manager
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_active_manager());

revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
