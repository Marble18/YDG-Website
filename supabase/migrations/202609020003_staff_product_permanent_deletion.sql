-- PR #20 follow-up business decision: active owner and active staff may both
-- permanently delete products. Customer, anonymous and disabled accounts remain denied.

create or replace function public.tombstone_product(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare p public.products%rowtype; category_label text; removed_cart_count bigint; already_deleted boolean;
begin
  if not public.is_owner_or_staff() then
    raise exception 'Active owner or staff access is required' using errcode = '42501';
  end if;
  if p_product_id is null then raise exception 'Product ID is required' using errcode = '22004'; end if;

  select * into p from public.products where id = p_product_id for update;
  if not found then raise exception 'Product was not found' using errcode = 'P0002'; end if;
  already_deleted := p.deleted_at is not null;

  if not already_deleted then
    select name into category_label from public.categories where id = p.category_id;
    delete from public.cart_items where product_id = p.id;
    get diagnostics removed_cart_count = row_count;
    update public.products set
      is_active = false, deleted_at = now(), deleted_by = auth.uid(),
      deletion_reason = 'Manager permanent delete', deleted_image_url = image_url,
      image_cleanup_status = case when image_url is null then 'not_required' else 'pending' end,
      category_name_snapshot = coalesce(category_label, category_name_snapshot),
      category_id = null, updated_at = now()
    where id = p.id returning * into p;
    insert into public.permanent_deletion_audit(actor_id, target_id, target_type, target_label, result, safe_metadata)
    values (auth.uid(), p.id, 'product', p.name, 'database_tombstoned',
      jsonb_build_object('removed_cart_items', removed_cart_count, 'had_image', p.deleted_image_url is not null));
  end if;

  return jsonb_build_object('product_id', p.id, 'product_name', p.name,
    'image_url', p.deleted_image_url, 'image_cleanup_status', p.image_cleanup_status,
    'already_deleted', already_deleted);
end;
$$;

revoke all on function public.tombstone_product(uuid) from public;
grant execute on function public.tombstone_product(uuid) to authenticated;

comment on function public.tombstone_product(uuid) is
  'Active-owner-or-staff irreversible catalogue tombstone. Preserves order/inventory history and removes carts atomically.';

-- Rollback: restore the owner-only authorization check from migration
-- 202609020001. Existing tombstones remain irreversible.
