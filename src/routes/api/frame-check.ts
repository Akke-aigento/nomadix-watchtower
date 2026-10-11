import { createFileRoute } from "@tanstack/react-router";

/**
 * Mag deze site in een kader (iframe) binnen Baken? Kijkt naar X-Frame-Options en
 * CSP frame-ancestors van de echte pagina. Enkel voor ingelogde Watchtower-admins.
 * GET /api/frame-check?url=https://…
 */
export const Route = createFileRoute("/api/frame-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { isBakenAdmin } = await import("@/lib/baken-auth.server");
        if (!(await isBakenAdmin(request))) return new Response("Unauthorized", { status: 401 });
        const url = new URL(request.url).searchParams.get("url") ?? "";
        if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(url))
          return Response.json({ frameable: false, reason: "geen https-adres" });
        try {
          const res = await fetch(url, {
            redirect: "follow",
            headers: { "User-Agent": "NomadixWatchtower/2 (+frame-check)" },
            signal: AbortSignal.timeout(6000),
          });
          const xfo = (res.headers.get("x-frame-options") ?? "").toLowerCase();
          const csp = (res.headers.get("content-security-policy") ?? "").toLowerCase();
          const fa = csp.match(/frame-ancestors([^;]*)/)?.[1]?.trim() ?? "";
          const origin = new URL(request.url).origin.toLowerCase();
          const faOk = !fa || fa.includes("*") || fa.includes(origin);
          const frameable = !xfo && faOk;
          return Response.json({
            frameable,
            finalUrl: res.url,
            reason: frameable ? null : xfo ? `X-Frame-Options: ${xfo}` : `frame-ancestors ${fa}`,
          });
        } catch (e) {
          return Response.json({ frameable: false, reason: String(e).slice(0, 120) });
        }
      },
    },
  },
});
