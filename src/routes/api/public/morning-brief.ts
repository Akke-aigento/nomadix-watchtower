import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/morning-brief")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request) {
  const provided = request.headers.get("x-cron-secret");
  const { isValidCronSecret } = await import("@/lib/cron-secret.server");
  if (!provided || !(await isValidCronSecret(provided))) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const { morningBrief } = await import("@/lib/morning-brief.server");
    const dryRun = new URL(request.url).searchParams.get("dry") === "1";
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
