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
          .select('id,order_number,customer_id,status,delivery_address,bus_station,contact_phone,preferred_delivery_date,subtotal,total,confirmed_subtotal,confirmed_total,delivery_proof_url,customer_note,staff_note,created_at,updated_at,profiles!orders_customer_id_fkey(full_name,username),order_items(id,product_id,product_name,unit,unit_price,quantity,line_total,confirmed_quantity,confirmed_unit_price,confirmed_line_total,picked)')
          .order('created_at', { ascending: false });
        if (result.error) throw result.error;
        return result.data || [];
      },
      updateStatus: async function (orderId, status) {
        var result = await client.from('orders').update({ status: status }).eq('id', orderId).select('id').single();
        if (result.error) throw result.error;
        return result.data;
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
