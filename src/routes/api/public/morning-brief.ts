import { createFileRoute } from "@tanstack/react-router";

/**
 * Ochtendbrief. De cron vuurt om 05:30 én 06:30 UTC; enkel de run die in
 * Brussel 07:xx valt verstuurt (zomer- en wintertijd zonder cron-gedoe).
 * ?dry=1 = voorbeeld zonder te versturen, ?force=1 = nu versturen.
 */
export const Route = createFileRoute("/api/public/morning-brief")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

function brusselsHour(d = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hour: "2-digit", hour12: false }).format(d),
  );
}

async function handle(request: Request) {
  const provided = request.headers.get("x-cron-secret");
  const { isValidCronSecret } = await import("@/lib/cron-secret.server");
  if (!provided || !(await isValidCronSecret(provided))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dry") === "1";
  const force = params.get("force") === "1";
  if (!dryRun && !force && brusselsHour() !== 7) {
    return Response.json({ sent: false, skipped: "niet 07:xx in Brussel", hour: brusselsHour() });
  }
  try {
    const { morningBrief } = await import("@/lib/morning-brief.server");
    const result = await morningBrief({ dryRun });
    if (result.sent) await pingHeartbeat();
    return Response.json(result);
  } catch (e) {
    console.error("morning-brief failed", e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Externe heartbeat-monitor pingen; fouten worden enkel gelogd. */
async function pingHeartbeat() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("get_heartbeat_url");
    if (error) throw error;
    const url = typeof data === "string" ? data.trim() : "";
    if (!url) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      await fetch(url, { method: "GET", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error("heartbeat ping failed", e);
  }
}
