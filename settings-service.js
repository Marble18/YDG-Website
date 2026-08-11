(function () {
  'use strict';

  function createSettingsService(client) {
    async function load() {
      var results = await Promise.all([
        client.from('app_settings').select('maintenance_mode,backup_frequency,updated_at').eq('id', 1).single(),
        client.from('voucher_settings').select('title,color,footer_text,updated_at').eq('id', 1).single()
      ]);
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
      return {
        maintenanceMode: Boolean(results[0].data.maintenance_mode),
        backupFrequency: results[0].data.backup_frequency,
        voucher: {
          title: results[1].data.title,
          accentColor: results[1].data.color,
          footer: results[1].data.footer_text
        },
        updatedAt: results.map(function (result) { return result.data.updated_at; }).sort().pop()
      };
    }

    async function call(name, args) {
      var result = await client.rpc(name, args);
      if (result.error) throw result.error;
    }

    return {
      load: load,
      saveSite: function (settings) {
        return call('update_site_settings', {
          p_maintenance_mode: Boolean(settings.maintenanceMode),
          p_backup_frequency: settings.backupFrequency
        });
      },
      saveVoucher: function (voucher) {
        return call('update_voucher_settings', {
          p_title: voucher.title,
          p_color: voucher.accentColor,
          p_footer_text: voucher.footer
        });
      }
    };
  }

  window.createSettingsService = createSettingsService;
})();
