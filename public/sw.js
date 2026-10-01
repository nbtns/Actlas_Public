/**
 * Actlas Service Worker
 *
 * 認証が必要な画面やAPIは保存せず、更新時に壊れやすいNext.jsの静的ファイルだけを
 * ネットワーク優先 + 失敗時キャッシュで扱う。
 */

const SW_VERSION = 'v3';
const CACHE_PREFIX = 'actlas-';
const PRECACHE_NAME = `${CACHE_PREFIX}precache-${SW_VERSION}`;
const NEXT_STATIC_NAME = `${CACHE_PREFIX}next-static-${SW_VERSION}`;
const STABLE_ASSET_NAME = `${CACHE_PREFIX}stable-assets-${SW_VERSION}`;

const MAX_NEXT_STATIC_ENTRIES = 120;
const MAX_STABLE_ASSET_ENTRIES = 40;

const PRECACHE_URLS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isApiOrRealtimePath(pathname) {
  return pathname.startsWith('/api/') || pathname.startsWith('/socket.io');
}

function isNextStaticPath(pathname) {
  return pathname.startsWith('/_next/static/');
}

function isManifestPath(pathname) {
  return pathname === '/manifest.json';
}

function isStableAssetPath(pathname) {
  return (
    pathname.startsWith('/icons/') ||
    pathname.endsWith('.woff2') ||
    pathname.endsWith('.woff')
  );
}

function isCacheableResponse(response) {
  if (!response || !response.ok || response.type !== 'basic') return false;
  const cacheControl = response.headers.get('Cache-Control') || '';
  return !/(no-store|no-cache|private)/i.test(cacheControl);
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((request) => cache.delete(request)));
}

async function cacheResponse(cacheName, request, response, maxEntries) {
  if (!isCacheableResponse(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  await trimCache(cacheName, maxEntries);
}

async function addPrecacheItems() {
  const cache = await caches.open(PRECACHE_NAME);
  await Promise.all(
    PRECACHE_URLS.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch((error) => {
        console.warn('[SW] precache skipped:', url, error);
      })
    )
  );
}

async function networkFirst(request, cacheName, maxEntries) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cacheResponse(cacheName, request, response, maxEntries);
      return response;
    }

    const cached = await caches.match(request);
    return cached || response;
  } catch (_error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw _error;
  }
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cacheResponse(cacheName, request, response, maxEntries);
  }
  return response;
}

function offlineResponse() {
  return new Response(
    '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>オフラインです</title><body style="margin:0;background:#18181b;color:#f4f4f5;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center"><main><h1 style="font-size:20px;margin:0 0 12px">サーバーに接続できません</h1><p style="color:#a1a1aa;line-height:1.6;margin:0">ネットワークを確認して、もう一度開いてください。</p></main></body></html>',
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(addPrecacheItems().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name.startsWith(CACHE_PREFIX))
            .filter((name) => ![PRECACHE_NAME, NEXT_STATIC_NAME, STABLE_ASSET_NAME].includes(name))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || !isSameOrigin(url) || isApiOrRealtimePath(url.pathname)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => offlineResponse()));
    return;
  }

  if (isNextStaticPath(url.pathname)) {
    event.respondWith(networkFirst(request, NEXT_STATIC_NAME, MAX_NEXT_STATIC_ENTRIES));
    return;
  }

  if (isManifestPath(url.pathname)) {
    event.respondWith(networkFirst(request, STABLE_ASSET_NAME, MAX_STABLE_ASSET_ENTRIES));
    return;
  }

  if (isStableAssetPath(url.pathname)) {
    event.respondWith(cacheFirst(request, STABLE_ASSET_NAME, MAX_STABLE_ASSET_ENTRIES));
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_error) {
    payload = {};
  }

  const title = payload.title || 'Actlas';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || payload.kind || 'actlas-notification',
    data: {
      url: payload.url || '/',
      channelId: payload.channelId,
      messageId: payload.messageId,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === targetUrl.origin) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl.href);
          }
          return undefined;
        }
      }
      return clients.openWindow(targetUrl.href);
    })
  );
});
