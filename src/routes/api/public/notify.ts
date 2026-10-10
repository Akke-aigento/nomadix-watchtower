import { createFileRoute } from "@tanstack/react-router";

/**
 * Melding sturen vanuit een cron of een geplande Claude-taak.
 * Beveiligd met x-cron-secret. Body: { title, body, url?, severity?, tag?, mail?: boolean }
 */
export const Route = createFileRoute("/api/public/notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret");
        const { isValidCronSecret } = await import("@/lib/cron-secret.server");
        if (!provided || !(await isValidCronSecret(provided))) return new Response("Unauthorized", { status: 401 });

        let input: { title?: string; body?: string; url?: string; severity?: string; tag?: string; mail?: boolean };
        try {
          input = await request.json();
        } catch {
          return Response.json({ error: "ongeldige JSON" }, { status: 400 });
        }
        if (!input.title) return Response.json({ error: "title ontbreekt" }, { status: 400 });

        const { pushToAll } = await import("@/lib/notify.server");
        const results = await pushToAll(
          {
            title: input.title.slice(0, 120),
            body: (input.body ?? "").slice(0, 400),
            url: input.url ?? "/dashboard",
            tag: input.tag,
            severity: input.severity ?? "info",
          },
          input.severity === "actie" ? "high" : "normal",
        );

        let mailed = false;
        if (input.mail) {
          const { sendAlertMail } = await import("@/lib/scan.server");
          const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          mailed = await sendAlertMail(
            input.title,
            `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#17191A"><p><strong>${esc(input.title)}</strong></p><p>${esc(input.body ?? "")}</p></div>`,
          );
        }

        return Response.json({
          devices: results.length,
          delivered: results.filter((r) => r.status >= 200 && r.status < 300).length,
          mailed,
          results: results.map((r) => ({ status: r.status, error: r.error, host: new URL(r.endpoint).host })),
        });
      },
    },
  },
});
