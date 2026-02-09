// Retire older web exports without touching saved books or pending entries.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("hisaab-public-shell-v1-"))
          await caches.delete(name);
      }
      await self.registration.unregister();
    })(),
  );
});
