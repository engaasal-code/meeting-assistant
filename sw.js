/* Meeting Assistant service worker: offline cache + daily task summary notification.
   Put this file in the same folder as the app's HTML file. */
const CACHE = 'ma-app-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Network first, cache fallback, so the app opens offline after the first visit.
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return;
  if (url.pathname.endsWith('/__ma_summary')) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(r, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match(new URL('./', self.registration.scope).href)))
  );
});

const ymd = d => { d = new Date(d); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

// Daily summary in the background (Android Chrome / Edge, installed app only).
// The page stores only counts and due dates here, never task titles.
async function digest() {
  const meta = await caches.open('ma-meta');
  const r = await meta.match(new URL('__ma_summary', self.registration.scope).href);
  if (!r) return;
  const s = await r.json();
  if (!s.on) return;
  const td = ymd(Date.now());
  const last = await meta.match(new URL('__ma_last', self.registration.scope).href);
  if (last && (await last.text()) === td) return;
  if (new Date().getHours() < (s.hour || 9)) return;
  const open = (s.items || []).filter(i => i.s !== 'deliv');
  if (!open.length) return;
  const over = open.filter(i => i.d && i.d < td).length;
  const ar = s.lang !== 'en';
  const body = ar
    ? `لديك ${open.length} مهام مفتوحة` + (over ? `، منها ${over} تجاوزت موعد التسليم` : '')
    : `You have ${open.length} open tasks` + (over ? `, ${over} past the due date` : '');
  await self.registration.showNotification(ar ? 'مساعد الاجتماعات · المهام المعلقة' : 'Meeting Assistant · Pending tasks',
    { body, tag: 'ma-digest', dir: ar ? 'rtl' : 'ltr', lang: ar ? 'ar' : 'en', renotify: true });
  await meta.put(new URL('__ma_last', self.registration.scope).href, new Response(td));
}
self.addEventListener('periodicsync', e => { if (e.tag === 'ma-digest') e.waitUntil(digest()); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(self.registration.scope);
  }));
});
