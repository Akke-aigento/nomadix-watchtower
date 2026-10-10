import { createFileRoute } from "@tanstack/react-router";

/**
 * Diagnose: draai één check live zonder iets op te slaan.
 * GET /api/public/check?url=https://…&check=http|ssl|dns|domain   (x-cron-secret)
 */
export const Route = createFileRoute("/api/public/check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret");
        const { isValidCronSecret } = await import("@/lib/cron-secret.server");
        if (!provided || !(await isValidCronSecret(provided))) return new Response("Unauthorized", { status: 401 });
        const params = new URL(request.url).searchParams;
        const url = params.get("url");
        const check = params.get("check") ?? "http";
        if (!url) return Response.json({ error: "url ontbreekt" }, { status: 400 });
        const c = await import("@/lib/checks.server");
        const fn = { http: c.checkHttp, ssl: c.checkSsl, dns: c.checkDns, domain: c.checkDomain }[check];
        if (!fn) return Response.json({ error: `onbekende check ${check}` }, { status: 400 });
        const started = Date.now();
        const outcome = await fn(url);
        return Response.json({ ...outcome, took_ms: Date.now() - started });
      },
    },
  },
});
