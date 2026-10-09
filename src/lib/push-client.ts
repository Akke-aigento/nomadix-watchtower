/** Pushmeldingen in de browser: toestel registreren, afmelden, status. */
import { supabase } from "@/integrations/supabase/client";

export const VAPID_PUBLIC_KEY =
  "BDD4e1jt5Bz_lCiJeh8qci66nJsLrliU2cAx0w92lyyX9wdSyitw-JS5_CbkKgMEsh01gTjVM_B1IMY3J_a3MZc";

export type PushState =
  | "unsupported"
  | "needs-homescreen"
  | "denied"
  | "off"
  | "on";

function b64uToUint8(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js"));
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "needs-homescreen";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Moet vanuit een klik (gebruikersgebaar) aangeroepen worden. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Meldingen niet toegestaan");
  const reg = await registration();
  if (!reg) throw new Error("Service worker niet beschikbaar");
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToUint8(VAPID_PUBLIC_KEY) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 300),
      user_id: user.user?.id ?? null,
      failure_count: 0,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

export async function sendTestPush(): Promise<{ devices: number; delivered: number }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Niet ingelogd");
  const res = await fetch("/api/push/test", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Test mislukt (${res.status})`);
  return res.json();
}
