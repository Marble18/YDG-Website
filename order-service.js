(function () {
  'use strict';

  function createOrderService(client) {
    async function rpc(name, args) {
      var result = await client.rpc(name, args || {});
      if (result.error) throw result.error;
      return result.data;
    }

    return {
      listCart: async function () {
        var result = await client.from('cart_items')
          .select('product_id, quantity, updated_at, products(id,name,price,unit,minimum_order_quantity,image_url,is_active)')
          .order('created_at', { ascending: true });
        if (result.error) throw result.error;
        return result.data || [];
      },
      setCartItem: function (productId, quantity) {
        return rpc('set_cart_item', { p_product_id: productId, p_quantity: quantity });
      },
      removeCartItem: function (productId) {
        return rpc('remove_cart_item', { p_product_id: productId });
      },
      checkout: function (details) {
        return rpc('checkout_cart', {
          p_idempotency_key: details.idempotencyKey,
          p_phone: details.phone,
          p_delivery_address: details.address,
          p_bus_station: details.busStation || null,
          p_delivery_date: details.deliveryDate || null,
          p_customer_note: details.note || null
        });
      },
      listOrders: async function () {
        var result = await client.from('orders')
          .select('id,order_number,customer_id,status,delivery_address,bus_station,contact_phone,preferred_delivery_date,subtotal,total,confirmed_subtotal,confirmed_total,customer_note,staff_note,created_at,updated_at,profiles!orders_customer_id_fkey(full_name,username),delivery_proofs(id,object_path,mime_type,file_size,uploaded_at,note),order_items(id,product_id,product_name,unit,unit_price,quantity,line_total,confirmed_quantity,confirmed_unit_price,confirmed_line_total,picked)')
          .order('created_at', { ascending: false });
        if (result.error) throw result.error;
        return result.data || [];
      },
      listOwnerOrders: async function (options) {
        var result = await rpc('list_owner_orders', {
          p_group: options.group,
          p_search: options.search || '',
          p_offset: options.offset || 0,
          p_limit: options.limit || 20
        });
        var orderIds = (result.rows || []).concat(result.recent_rows || []).map(function (order) { return order.id; });
        if (orderIds.length) {
          var proofs = await client.from('delivery_proofs')
            .select('id,order_id,object_path,mime_type,file_size,uploaded_at,note')
            .in('order_id', Array.from(new Set(orderIds)));
          if (proofs.error) throw proofs.error;
          var byOrder = {};
          (proofs.data || []).forEach(function (proof) { byOrder[proof.order_id] = proof; });
          (result.rows || []).forEach(function (order) { order.delivery_proofs = byOrder[order.id] ? [byOrder[order.id]] : []; });
          (result.recent_rows || []).forEach(function (order) { order.delivery_proofs = byOrder[order.id] ? [byOrder[order.id]] : []; });
        }
        return result;
      },
      updateStatus: function (orderId, status) {
        return rpc('update_order_status', { p_order_id: orderId, p_new_status: status });
      },
      confirmItem: function (orderItemId, confirmedQuantity, confirmedUnitPrice) {
        return rpc('confirm_order_item', {
          p_order_item_id: orderItemId,
          p_confirmed_quantity: confirmedQuantity,
          p_confirmed_unit_price: confirmedUnitPrice
        });
      }
    };
  }

  window.createOrderService = createOrderService;
})();
