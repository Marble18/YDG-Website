(function () {
  'use strict';

  var PROJECT_REF = 'tfvwfpvdqcbgqnijhhpd';
  var DIRECT_URL = 'https://' + PROJECT_REF + '.supabase.co';
  var PROXY_PATH = '/supabase';

  function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  }

  function apiUrl(locationValue) {
    var location = locationValue || window.location;
    if ((location.protocol === 'https:' || location.protocol === 'http:') && !isLocalHost(location.hostname)) {
      return location.origin + PROXY_PATH;
    }
    return DIRECT_URL;
  }

  function runtimeStorageUrl(value, locationValue) {
    var source = String(value || '');
    if (!source || source.indexOf('data:image/') === 0 || source.indexOf('blob:') === 0) return source;
    var location = locationValue || window.location;
    var currentApiUrl = apiUrl(location);
    if (source.indexOf(DIRECT_URL + '/') === 0) return currentApiUrl + source.slice(DIRECT_URL.length);
    if (source.indexOf(PROXY_PATH + '/') === 0) return currentApiUrl + source.slice(PROXY_PATH.length);
    try {
      var parsed = new URL(source, location.origin);
      if (parsed.pathname.indexOf(PROXY_PATH + '/') === 0) {
        return currentApiUrl + parsed.pathname.slice(PROXY_PATH.length) + parsed.search + parsed.hash;
      }
    } catch (error) { }
    return source;
  }

  function canonicalStorageUrl(value, locationValue) {
    var source = String(value || '');
    if (!source || source.indexOf('data:image/') === 0 || source.indexOf('blob:') === 0) return source;
    if (source.indexOf(DIRECT_URL + '/') === 0) return source;
    var location = locationValue || window.location;
    if (source.indexOf(PROXY_PATH + '/') === 0) return DIRECT_URL + source.slice(PROXY_PATH.length);
    try {
      var parsed = new URL(source, location.origin);
      if (parsed.pathname.indexOf(PROXY_PATH + '/') === 0) {
        return DIRECT_URL + parsed.pathname.slice(PROXY_PATH.length) + parsed.search + parsed.hash;
      }
    } catch (error) { }
    return source;
  }

  window.YDG_SUPABASE = Object.freeze({
    projectRef: PROJECT_REF,
    directUrl: DIRECT_URL,
    proxyPath: PROXY_PATH,
    apiUrl: apiUrl(window.location),
    publishableKey: 'sb_publishable_1TYSPsIChtMyo_NjcSHQZg_A7uS0PsX',
    authStorageKey: 'sb-' + PROJECT_REF + '-auth-token',
    runtimeStorageUrl: runtimeStorageUrl,
    canonicalStorageUrl: canonicalStorageUrl
  });
})();
