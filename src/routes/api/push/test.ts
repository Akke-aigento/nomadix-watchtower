import { createFileRoute } from "@tanstack/react-router";

/** Testmelding naar alle geregistreerde toestellen. Enkel voor ingelogde admins. */
export const Route = createFileRoute("/api/push/test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !userData.user) return new Response("Unauthorized", { status: 401 });
        const { data: admin } = await supabaseAdmin
          .from("watchtower_admins")
          .select("user_id")
          .eq("user_id", userData.user.id)
          .maybeSingle();
        if (!admin) return new Response("Forbidden", { status: 403 });

        const { pushToAll } = await import("@/lib/notify.server");
        const results = await pushToAll({
          title: "Watchtower · testmelding",
          body: "Meldingen werken. Bij een echt probleem hoor je het meteen.",
          url: "/dashboard",
          tag: "test",
          severity: "ok",
        });
        return Response.json({
          devices: results.length,
          delivered: results.filter((r) => r.status >= 200 && r.status < 300).length,
          results: results.map((r) => ({ status: r.status, error: r.error, host: new URL(r.endpoint).host })),
        });
      },
    },
  },
});
