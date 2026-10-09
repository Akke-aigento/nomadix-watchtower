/* Watchtower service worker: enkel pushmeldingen, geen caching (altijd de live app). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Watchtower", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Watchtower";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    requireInteraction: data.severity === "actie",
    data: { url: data.url || "/dashboard" },
  };
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      if (self.navigator && "setAppBadge" in self.navigator) {
        try {
          if (data.severity === "actie") await self.navigator.setAppBadge(1);
          else if (data.severity === "ok") await self.navigator.clearAppBadge();
        } catch (e) {}
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/dashboard", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
