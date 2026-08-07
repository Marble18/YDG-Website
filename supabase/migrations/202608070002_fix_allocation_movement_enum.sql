-- Correct the inventory enum cast in the already-deployed allocation function.

create or replace function public.set_order_item_allocation(p_order_item_id uuid, p_allocated_quantity integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item_row record;
  product_stock integer;
  difference integer;
  resulting integer;
begin
  if not public.is_owner_or_staff() then raise exception 'Only active owner or staff can allocate stock' using errcode = '42501'; end if;
  select oi.id, oi.order_id, oi.product_id, oi.quantity, oi.allocated_quantity, o.order_number
  into item_row from public.order_items oi join public.orders o on o.id = oi.order_id
  where oi.id = p_order_item_id for update of oi;
  if not found then raise exception 'Order item was not found'; end if;
  if p_allocated_quantity is null or p_allocated_quantity < 0 or p_allocated_quantity > item_row.quantity then
    raise exception 'Allocated quantity must be between 0 and requested quantity';
  end if;
  if item_row.product_id is null then raise exception 'The original product no longer exists'; end if;
  select stock_quantity into product_stock from public.products where id = item_row.product_id for update;
  difference := p_allocated_quantity - item_row.allocated_quantity;
  if difference > product_stock then raise exception 'Not enough current stock to increase allocation'; end if;
  resulting := product_stock - difference;
  update public.products set stock_quantity = resulting where id = item_row.product_id;
  update public.order_items set allocated_quantity = p_allocated_quantity where id = item_row.id;
  if difference <> 0 then
    insert into public.inventory_movements (product_id, movement_type, quantity, previous_stock, resulting_stock, note, order_id, created_by)
    values (item_row.product_id, (case when difference > 0 then 'stock_out' else 'stock_in' end)::public.inventory_movement_type,
      abs(difference), product_stock, resulting, 'Allocation adjusted for order ' || item_row.order_number,
      item_row.order_id, auth.uid());
  end if;
end;
$$;

revoke all on function public.set_order_item_allocation(uuid, integer) from public;
grant execute on function public.set_order_item_allocation(uuid, integer) to authenticated;
