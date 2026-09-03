(function (global) {
  'use strict';

  function safeMessage(error, fallback) {
    if (error && error.context && typeof error.context.json === 'function') {
      return error.context.json().then(function (body) {
        return body && (body.message || body.error) ? (body.message || body.error) : fallback;
      }).catch(function () { return fallback; });
    }
    return Promise.resolve(error && error.message ? error.message : fallback);
  }

  function createDeletionService(client) {
    async function invoke(body, fallback) {
      var result = await client.functions.invoke('permanent-delete', { body: body });
      if (result.error) throw new Error(await safeMessage(result.error, fallback));
      if (!result.data || result.data.ok === false) throw new Error((result.data && (result.data.message || result.data.error)) || fallback);
      return result.data;
    }
    return {
      deleteProduct: function (productId) {
        return invoke({ action: 'delete-product', productId: productId }, 'Product could not be permanently deleted.');
      },
      deleteCustomer: function (customerId) {
        return invoke({ action: 'delete-customer', customerId: customerId }, 'Customer account could not be permanently deleted.');
      }
    };
  }

  global.createDeletionService = createDeletionService;
}(window));
