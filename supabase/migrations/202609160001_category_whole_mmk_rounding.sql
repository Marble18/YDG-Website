-- PR #24: definitions only. Applying this migration never adjusts existing prices.
begin;

create or replace function public.category_adjusted_price(p_price numeric, p_percentage numeric)
returns numeric language plpgsql immutable set search_path = public as $$
begin
  if p_percentage is null or p_percentage < -100 or p_percentage > 10000 then
    raise exception 'Percentage is outside the allowed range' using errcode = '22023';
  end if;
  if p_price is null then return null; end if;
  -- Numeric arithmetic: exact decimal half-up rounding for nonnegative prices.
  return greatest(0, round(p_price * (100 + p_percentage) / 100, 0));
end;
$$;
revoke all on function public.category_adjusted_price(numeric,numeric) from public, anon, authenticated;

create or replace function public.preview_product_category_prices(p_category_id uuid, p_percentage numeric)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if public.is_owner_or_staff() is not true then
    raise exception 'Only an active owner or staff account can adjust prices' using errcode = '42501';
  end if;
  perform public.category_adjusted_price(0, p_percentage);
  with eligible as (
    select id, name, pcs_price, box_price
    from public.products
    where category_id = p_category_id and is_active = true and deleted_at is null
  ), sample as (
    select id, name, pcs_price, box_price,
      public.category_adjusted_price(pcs_price, p_percentage) as adjusted_pcs_price,
      public.category_adjusted_price(box_price, p_percentage) as adjusted_box_price
    from eligible order by name, id limit 5
  )
  select jsonb_build_object(
    'rounding_rule', 'whole_mmk_v1',
    'product_count', (select count(*) from eligible),
    'samples', coalesce((select jsonb_agg(to_jsonb(sample) order by name, id) from sample), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.adjust_product_category_prices(p_category_id uuid, p_percentage numeric)
returns integer language plpgsql security definer set search_path = public as $$
declare changed_count integer;
begin
  if public.is_owner_or_staff() is not true then
    raise exception 'Only an active owner or staff account can adjust prices' using errcode = '42501';
  end if;
  perform public.category_adjusted_price(0, p_percentage);
  -- One atomic update; the existing sales compatibility trigger maintains price/unit.
  -- Values come from current locked rows, never from preview/client-supplied prices.
  update public.products
  set pcs_price = public.category_adjusted_price(pcs_price, p_percentage),
      box_price = public.category_adjusted_price(box_price, p_percentage),
      updated_at = now()
  where category_id = p_category_id and is_active = true and deleted_at is null;
  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.preview_product_category_prices(uuid,numeric) from public, anon;
revoke all on function public.adjust_product_category_prices(uuid,numeric) from public, anon;
grant execute on function public.preview_product_category_prices(uuid,numeric) to authenticated;
grant execute on function public.adjust_product_category_prices(uuid,numeric) to authenticated;
commit;

-- Rollback: restore ONLY adjust_product_category_prices from 202609070001 (nearest 50)
-- and drop preview_product_category_prices, then category_adjusted_price in one transaction.
-- The new UI fails closed without the preview RPC; restore the earlier UI if desired.
-- Do not rerun the full historical migration or reverse-adjust prices: rounding is lossy.
-- This migration/rollback does not modify product data; previously confirmed changes
-- require a separately reviewed backup-based recovery, never an automatic percentage undo.
