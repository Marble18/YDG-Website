(function () {
  'use strict';

  function createCategoryService(client) {
    return {
      previewPriceAdjustment: async function (categoryId, percentage) {
        var result = await client.rpc('preview_product_category_prices', { p_category_id: categoryId, p_percentage: percentage });
        if (result.error) {
          if (result.error.code === 'PGRST202' || result.error.code === '42883') throw new Error('Whole-MMK pricing migration is not available yet. No prices were changed. Ask the administrator to apply migration 202609160001.');
          throw result.error;
        }
        if (!result.data || result.data.rounding_rule !== 'whole_mmk_v1') throw new Error('Whole-MMK pricing preview is unavailable. No prices were changed.');
        return result.data;
      },
      adjustPrices: async function (categoryId, percentage) {
        var result = await client.rpc('adjust_product_category_prices', { p_category_id: categoryId, p_percentage: percentage });
        if (result.error) throw result.error;
        return Number(result.data || 0);
      },
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
