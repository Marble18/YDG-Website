(function () {
  'use strict';

  var BUCKET = 'delivery-proofs';
  var MAX_BYTES = 5 * 1024 * 1024;
  var EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  function createDeliveryProofService(client) {
    function validateFile(file) {
      if (!file || !EXTENSIONS[file.type]) throw new Error('Choose a JPEG, PNG or WebP image.');
      if (file.size < 1 || file.size > MAX_BYTES) throw new Error('Delivery proof must be 5 MB or smaller.');
    }

    function exactPath(orderId, file) {
      validateFile(file);
      return 'orders/' + orderId + '/' + crypto.randomUUID() + '.' + EXTENSIONS[file.type];
    }

    async function removeExact(path) {
      if (!path) return;
      var result = await client.storage.from(BUCKET).remove([path]);
      if (result.error) throw result.error;
    }

    return {
      validateFile: validateFile,
      uploadAndSave: async function (orderId, file, options) {
        var path = exactPath(orderId, file);
        var upload = await client.storage.from(BUCKET).upload(path, file, {
          cacheControl: '3600', contentType: file.type, upsert: false
        });
        if (upload.error) throw upload.error;
        var saved;
        try {
          saved = await client.rpc('save_delivery_proof', {
            p_order_id: orderId,
            p_object_path: path,
            p_mime_type: file.type,
            p_file_size: file.size,
            p_note: options.note || null,
            p_mark_delivered: Boolean(options.markDelivered)
          });
          if (saved.error) throw saved.error;
        } catch (error) {
          try { await removeExact(path); } catch (cleanupError) { error.cleanupWarning = true; }
          throw error;
        }
        var previousPath = saved.data && saved.data.previous_object_path;
        var cleanupWarning = false;
        if (previousPath && previousPath !== path) {
          try { await removeExact(previousPath); } catch (error) { cleanupWarning = true; }
        }
        return { metadata: saved.data, cleanupWarning: cleanupWarning };
      },
      signedUrl: async function (proof) {
        if (!proof || !proof.objectPath) throw new Error('No delivery proof is recorded.');
        var result = await client.storage.from(BUCKET).createSignedUrl(proof.objectPath, 120);
        if (result.error) throw result.error;
        return result.data.signedUrl;
      },
      remove: async function (orderId) {
        var result = await client.rpc('remove_delivery_proof', { p_order_id: orderId });
        if (result.error) throw result.error;
        if (!result.data) return { removed: false, cleanupWarning: false };
        try {
          await removeExact(result.data);
          return { removed: true, cleanupWarning: false };
        } catch (error) {
          return { removed: true, cleanupWarning: true };
        }
      }
    };
  }

  window.createDeliveryProofService = createDeliveryProofService;
})();
