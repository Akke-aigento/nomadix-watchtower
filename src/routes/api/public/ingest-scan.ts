import { createFileRoute } from "@tanstack/react-router";

/**
 * Integratiescan inlezen zonder SQL te plakken.
 *   node scripts/integration-scan.mjs --post https://nomadix-watchtower.lovable.app/api/public/ingest-scan <repo>=<pad>
 * Body = de compacte JSON van integration-scan.mjs ({ i, u, h, r }); roept public.wt_ingest_scan aan.
 * Beveiligd met x-cron-secret.
 */
export const Route = createFileRoute("/api/public/ingest-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});

const MAX_BYTES = 2_000_000;

async function handle(request: Request) {
  const provided = request.headers.get("x-cron-secret");
  const { isValidCronSecret } = await import("@/lib/cron-secret.server");
  if (!provided || !(await isValidCronSecret(provided))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const text = await request.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "scan te groot" }, { status: 413 });
  let scan: unknown;
  try {
    scan = JSON.parse(text);
  } catch {
    return Response.json({ error: "geen geldige JSON" }, { status: 400 });
  }
  const s = scan as Record<string, unknown> | null;
  if (!s || typeof s !== "object" || !["i", "u", "h", "r"].every((k) => Array.isArray(s[k]))) {
    return Response.json({ error: "verwacht { i, u, h, r } (compacte scan)" }, { status: 400 });
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("wt_ingest_scan", { scan: s as never });
    if (error) throw error;
    return Response.json({ ok: true, repos: s.r, usages: (s.u as unknown[]).length, result: data });
  } catch (e) {
    console.error("ingest-scan failed", e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
