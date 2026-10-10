import { createFileRoute } from "@tanstack/react-router";

/**
 * Abonneerbare agenda (iPhone: Instellingen › Agenda › Accounts › Voeg toe › Andere › Agenda-abonnement).
 * GET /api/public/agenda.ics?token=<agenda_token uit private.config>
 * Hele-dag-items met een herinnering 30 en 7 dagen vooraf (actie: ook 1 dag vooraf).
 */
export const Route = createFileRoute("/api/public/agenda.ics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token") ?? "";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: expected } = await supabaseAdmin.rpc("get_agenda_token");
        if (!token || typeof expected !== "string" || token !== expected) return new Response("Unauthorized", { status: 401 });

        const { data: items } = await supabaseAdmin
          .from("agenda")
          .select("id, title, description, due_date, kind, severity, source_url, status")
          .eq("status", "open")
          .order("due_date");

        const { buildIcs } = await import("@/lib/ics");
        return new Response(buildIcs(items ?? []), {
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            "content-disposition": 'inline; filename="watchtower.ics"',
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
