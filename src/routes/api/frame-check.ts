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
        const { frameCheck } = await import("@/lib/frame-check.server");
        return Response.json(await frameCheck(url, new URL(request.url).origin));
      },
    },
  },
});
