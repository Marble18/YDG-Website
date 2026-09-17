var SUPABASE_ORIGIN = 'https://tfvwfpvdqcbgqnijhhpd.supabase.co';
var PUBLISHABLE_KEY = 'sb_publishable_1TYSPsIChtMyo_NjcSHQZg_A7uS0PsX';
var PROXY_PREFIX = '/supabase';
var ALLOWED_SERVICE_PREFIXES = ['/auth/v1/', '/rest/v1/', '/storage/v1/', '/functions/v1/'];
var ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']);

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status: status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function allowedAuthorization(value) {
  if (!value) return true;
  if (value === 'Bearer ' + PUBLISHABLE_KEY) return true;
  return /^Bearer eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function safeServicePath(pathname) {
  if (pathname.indexOf(PROXY_PREFIX + '/') !== 0) return '';
  var upstreamPath = pathname.slice(PROXY_PREFIX.length);
  var decoded;
  try { decoded = decodeURIComponent(upstreamPath); } catch (error) { return ''; }
  if (decoded.indexOf('\\') !== -1 || decoded.indexOf('\0') !== -1 || decoded.split('/').some(function (part) { return part === '.' || part === '..'; })) return '';
  return ALLOWED_SERVICE_PREFIXES.some(function (prefix) { return upstreamPath.indexOf(prefix) === 0; }) ? upstreamPath : '';
}

function upstreamHeaders(request) {
  var headers = new Headers(request.headers);
  [
    'cookie', 'host', 'referer', 'forwarded', 'x-forwarded-for', 'x-forwarded-host',
    'x-forwarded-proto', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'connection',
    'content-length', 'transfer-encoding', 'x-nf-client-connection-ip'
  ].forEach(function (name) { headers.delete(name); });
  headers.set('apikey', PUBLISHABLE_KEY);
  return headers;
}

function responseHeaders(upstreamResponse, requestUrl, servicePath) {
  var headers = new Headers(upstreamResponse.headers);
  headers.delete('set-cookie');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-ydg-supabase-proxy', 'netlify-edge');
  if (servicePath.indexOf('/storage/v1/') !== 0) headers.set('cache-control', 'no-store');
  var location = headers.get('location');
  if (location) {
    try {
      var target = new URL(location, SUPABASE_ORIGIN);
      if (target.origin === SUPABASE_ORIGIN) {
        var incoming = new URL(requestUrl);
        headers.set('location', incoming.origin + PROXY_PREFIX + target.pathname + target.search + target.hash);
      }
    } catch (error) { }
  }
  return headers;
}

export default async function supabaseProxy(request) {
  var incoming = new URL(request.url);
  var servicePath = safeServicePath(incoming.pathname);
  if (!servicePath) return jsonError('Supabase proxy route is not allowed.', 404);
  if (!ALLOWED_METHODS.has(request.method)) return jsonError('Request method is not allowed.', 405);
  if (!allowedAuthorization(request.headers.get('authorization'))) return jsonError('Authorization format is not allowed.', 401);

  var upstream = new URL(servicePath + incoming.search, SUPABASE_ORIGIN);
  var options = {
    method: request.method,
    headers: upstreamHeaders(request),
    redirect: 'manual'
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') options.body = request.body;

  try {
    var upstreamResponse = await fetch(upstream, options);
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders(upstreamResponse, request.url, servicePath)
    });
  } catch (error) {
    return jsonError('The secure data service is temporarily unavailable. No data was changed.', 502);
  }
}

export const config = { path: '/supabase/*' };
