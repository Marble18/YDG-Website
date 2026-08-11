-- PR #17 fix: least-privilege grants required by the protected backup Edge Function.

grant select on table
  public.categories,
  public.products,
  public.profiles,
  public.orders,
  public.order_items,
  public.cart_items,
  public.inventory_movements,
  public.voucher_settings,
  public.app_settings,
  public.delivery_proofs
to service_role;

grant select, insert, update, delete on table public.business_restore_plans to service_role;
grant select, insert on table public.business_restore_audit to service_role;

comment on table public.business_restore_plans is
  'Short-lived primary-owner restore previews; direct browser roles have no table access.';
comment on table public.business_restore_audit is
  'Idempotency and audit records written by protected restore workflows.';

-- Rollback: revoke the grants in this migration only after the business-backup
-- Edge Function is disabled. No business data or policies are changed here.
