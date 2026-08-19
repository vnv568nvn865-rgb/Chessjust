/**
 * coop-sw.js — Service Worker للـ SharedArrayBuffer
 * يضيف COOP/COEP headers لصفحات HTML فقط (لا يمس API calls)
 * 
 * كيف يعمل:
 * 1. يعترض طلبات HTML فقط (content-type: text/html)
 * 2. يضيف COOP/COEP headers لتفعيل Cross-Origin Isolation
 * 3. يتيح SharedArrayBuffer لـ Stockfish multi-thread
 * 4. لا يمس طلبات Chess.com API أو أي مورد خارجي
 *
 * ملاحظة: يتطلب reload واحد بعد أول تثبيت
 */

const SW_VERSION = 'chessjust-coop-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // تخطي الطلبات الخارجية (Chess.com API وغيرها)
  if (url.origin !== self.location.origin) {
    return; // اتركها تمر بدون تعديل
  }

  // تخطي الـ Workers أنفسهم
  if (url.pathname.endsWith('coop-sw.js')) {
    return;
  }

  event.respondWith(
    fetch(event.request).then((response) => {
      const contentType = response.headers.get('content-type') || '';

      // فقط للـ HTML pages أضف COOP/COEP
      if (contentType.includes('text/html')) {
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
        newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      }

      // كل شيء آخر يمر بدون تعديل
      return response;
    }).catch(() => fetch(event.request))
  );
});
