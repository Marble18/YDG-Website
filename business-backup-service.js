(function () {
  'use strict';

  function createBusinessBackupService(client) {
    async function readableError(error) {
      var fallback = error && error.message && error.message !== 'Edge Function returned a non-2xx status code' ? error.message : 'Secure backup service rejected the request.';
      try {
        var response = error && error.context;
        if (response && typeof response.clone === 'function') {
          try {
            var payload = await response.clone().json();
            if (payload && payload.error) return payload.error;
          } catch (ignoredJson) { }
          if (response.status === 401 || response.status === 403) return 'Your session is not authorized. Log in again with the active primary owner account.';
          if (response.status === 413) return 'The selected backup file is larger than the secure upload limit.';
          if (response.status >= 500) return 'The secure backup service is temporarily unavailable. No data was changed; try again.';
        }
      } catch (ignored) { }
      return fallback;
    }

    async function invoke(action, extra) {
      var result = await client.functions.invoke('business-backup', {
        body: Object.assign({ action: action }, extra || {})
      });
      if (result.error) throw new Error(await readableError(result.error));
      if (result.data && result.data.ok === false) throw new Error(result.data.error || 'Backup operation failed.');
      return result.data;
    }

    async function invokeArchive(action, file, planId) {
      var form = new FormData();
      form.append('action', action);
      form.append('archive', file, file.name);
      if (planId) form.append('planId', planId);
      var result = await client.functions.invoke('business-backup', { body: form });
      if (result.error) throw new Error(await readableError(result.error));
      if (result.data && result.data.ok === false) throw new Error(result.data.error || 'Storage restore operation failed.');
      return result.data.result;
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
      previewStorageRestore: function (file) { return invokeArchive('preview-storage-restore', file); },
      confirmStorageRestore: function (file, planId) { return invokeArchive('confirm-storage-restore', file, planId); },
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
