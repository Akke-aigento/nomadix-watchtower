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
    const result = await morningBrief();
    return Response.json(result);
  } catch (e) {
    console.error("morning-brief failed", e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
