-- PR #17 hardening: disabling the primary owner must not promote another owner.

create or replace function public.is_primary_owner(check_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select check_user_id is not null and check_user_id = (
    select id from public.profiles
    where role::text = 'owner' and is_active = true
      and id = (
        select id from public.profiles
        where role::text = 'owner'
        order by created_at asc, id asc limit 1
      )
    limit 1
  )
$$;

revoke all on function public.is_primary_owner(uuid) from public;
grant execute on function public.is_primary_owner(uuid) to authenticated, service_role;

-- Rollback: restore the 202608110002 function body. No data changes are made here.
