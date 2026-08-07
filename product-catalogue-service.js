(function () {
  'use strict';

  var PRODUCT_COLUMNS = 'id, name, description, price, stock_quantity, unit, minimum_order_quantity, image_url, is_active, category_id, created_at, updated_at, categories(name)';

  function escapeLike(value) {
    return String(value || '').trim().replace(/[\\%_]/g, function (character) { return '\\' + character; });
  }

  function applyFilters(query, options) {
    if (options.visibility === 'active') query = query.eq('is_active', true);
    if (options.visibility === 'inactive') query = query.eq('is_active', false);
    if (options.categoryId) query = query.eq('category_id', options.categoryId);
    if (options.search) query = query.ilike('name', '%' + escapeLike(options.search) + '%');
    return query;
  }

  function ordered(query) {
    return query.order('created_at', { ascending: true }).order('id', { ascending: true });
  }

  function createProductCatalogueService(client) {
    return {
      list: async function (options) {
        var limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
        var offset = Math.max(0, Number(options.offset) || 0);
        var query = client.from('products').select(PRODUCT_COLUMNS, { count: 'exact' });
        query = ordered(applyFilters(query, options)).range(offset, offset + limit - 1);
        var result = await query;
        if (result.error) throw result.error;
        return { rows: result.data || [], count: Number(result.count) || 0 };
      },

      listAll: async function (options) {
        var rows = [];
        var offset = 0;
        var batchSize = 200;
        while (true) {
          var query = client.from('products').select(PRODUCT_COLUMNS);
          query = ordered(applyFilters(query, options)).range(offset, offset + batchSize - 1);
          var result = await query;
          if (result.error) throw result.error;
          rows = rows.concat(result.data || []);
          if (!result.data || result.data.length < batchSize) break;
          offset += batchSize;
        }
        return rows;
      },

      getByIds: async function (ids) {
        var uniqueIds = ids.filter(function (id, index, list) { return id && list.indexOf(id) === index; });
        if (!uniqueIds.length) return [];
        var result = await client.from('products').select(PRODUCT_COLUMNS).in('id', uniqueIds);
        if (result.error) throw result.error;
        return result.data || [];
      }
    };
  }

  window.createProductCatalogueService = createProductCatalogueService;
})();

