import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/run-scans")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");
  if (!secret || !provided || provided !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const { runScans } = await import("@/lib/scan.server");
    const result = await runScans();
    return Response.json(result);
  } catch (e) {
    console.error("run-scans failed", e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
