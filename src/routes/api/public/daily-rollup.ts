import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/daily-rollup")({
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
    const { dailyRollup } = await import("@/lib/scan.server");
    const result = await dailyRollup();
    return Response.json(result);
  } catch (e) {
    console.error("daily-rollup failed", e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
