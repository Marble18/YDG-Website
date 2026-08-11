(function () {
  'use strict';

  function createBusinessBackupService(client) {
    async function invoke(action, extra) {
      var result = await client.functions.invoke('business-backup', {
        body: Object.assign({ action: action }, extra || {})
      });
      if (result.error) throw result.error;
      if (result.data && result.data.ok === false) throw new Error(result.data.error || 'Backup operation failed.');
      return result.data;
    }
    return {
      createDatabaseBackup: function () { return invoke('create-database-backup'); },
      createStorageArchive: function () { return invoke('create-storage-archive'); },
      previewRestore: function (backup) {
        return invoke('preview-restore', { backup: backup }).then(function (response) { return response.result; });
      },
      confirmRestore: function (backup, planId) {
        return invoke('confirm-restore', { backup: backup, planId: planId }).then(function (response) { return response.result; });
      },
      readBackupFile: function (file) {
        if (!file || !/\.json$/i.test(file.name)) return Promise.reject(new Error('Choose a YDG .json business backup file.'));
        if (file.size > 12 * 1024 * 1024) return Promise.reject(new Error('Backup file must be 12 MB or smaller.'));
        return file.text().then(function (text) {
          try { return JSON.parse(text); } catch (error) { throw new Error('Backup JSON could not be read.'); }
        });
      }
    };
  }
  window.createBusinessBackupService = createBusinessBackupService;
})();
