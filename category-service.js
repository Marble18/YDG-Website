(function () {
  'use strict';

  function createCategoryService(client) {
    return {
      listManaged: async function () {
        var result = await client.rpc('list_managed_categories');
        if (result.error) throw result.error;
        return (result.data || []).map(function (row) {
          return {
            id: row.id,
            name: row.name,
            isActive: Boolean(row.is_active),
            productCount: Number(row.product_count) || 0
          };
        });
      },
      deleteEmpty: async function (categoryId) {
        var result = await client.rpc('delete_empty_category', { p_category_id: categoryId });
        if (result.error) throw result.error;
        return result.data;
      }
    };
  }

  window.createCategoryService = createCategoryService;
})();
