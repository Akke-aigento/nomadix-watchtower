/** Pushmeldingen naar alle geregistreerde toestellen (server-only). */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendPush, type PushPayload, type SendResult } from "@/lib/webpush.server";

let cachedJwk: JsonWebKey | null = null;

async function vapidJwk(): Promise<JsonWebKey | null> {
  if (cachedJwk) return cachedJwk;
  const { data, error } = await supabaseAdmin.rpc("get_vapid_private_jwk");
  if (error || typeof data !== "string" || !data) {
    console.error("VAPID-sleutel ontbreekt", error?.message);
    return null;
  }
  cachedJwk = JSON.parse(data) as JsonWebKey;
  return cachedJwk;
}

export async function pushToAll(payload: PushPayload, urgency: "high" | "normal" = "high"): Promise<SendResult[]> {
  const jwk = await vapidJwk();
  if (!jwk) return [];
  const { data: subs } = await supabaseAdmin.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  if (!subs?.length) return [];

  const results = await Promise.all(subs.map((s) => sendPush(s, payload, jwk, urgency)));
  const now = new Date().toISOString();
  await Promise.all(
    results.map(async (r, i) => {
      const sub = subs[i];
      if (r.gone) {
        await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
      } else if (r.status >= 200 && r.status < 300) {
        await supabaseAdmin.from("push_subscriptions").update({ last_success_at: now, failure_count: 0 }).eq("id", sub.id);
      } else {
        console.error("push mislukt", r.status, r.error);
        const { data: row } = await supabaseAdmin
          .from("push_subscriptions")
          .select("failure_count")
          .eq("id", sub.id)
          .maybeSingle();
        await supabaseAdmin
          .from("push_subscriptions")
          .update({ failure_count: (row?.failure_count ?? 0) + 1 })
          .eq("id", sub.id);
      }
    }),
  );
  return results;
}

export function anyDelivered(results: SendResult[]): boolean {
  return results.some((r) => r.status >= 200 && r.status < 300);
}
