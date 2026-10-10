import { createFileRoute } from "@tanstack/react-router";

/**
 * Baken — vrije vragen naar een taalmodel.
 * Enkel voor ingelogde Watchtower-admins (Bearer-token). De client stuurt de vraag + een compacte
 * context met de cijfers; het model antwoordt kort in het Vlaams en kiest welke beelden getoond worden.
 * Provider: OPENAI_API_KEY (als die er is), anders LOVABLE_API_KEY (Lovable AI Gateway).
 * Geen sleutel → 501, dan antwoordt Baken lokaal (0 credits).
 */
const SYSTEM = `Je bent Baken, de assistent van Watchtower (Nomadix BV, Akke). Je spreekt Vlaams, kort en direct, als een maat die meekijkt.
Antwoord in maximaal 3 zinnen, zonder opsommingstekens, zonder markdown. Gebruik enkel de cijfers uit de context; verzin niets.
Weet je iets niet, zeg dat eerlijk. Antwoord ALTIJD als JSON: {"say": "<tekst>", "show": [<0-2 uit "vandaag","credits","agenda","voorstellen">]}.`;

async function isAdmin(token: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || token.split(".").length !== 3) return false;
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: user } = await sb.auth.getUser(token);
  if (!user.user) return false;
  const { data } = await sb.rpc("is_watchtower_admin");
  return data === true;
}

async function callModel(messages: { role: string; content: string }[]): Promise<string | null> {
  const openai = process.env.OPENAI_API_KEY;
  const lovable = process.env.LOVABLE_API_KEY;
  const targets: Array<{ url: string; key: string; models: string[] }> = [];
  if (openai)
    targets.push({
      url: "https://api.openai.com/v1/chat/completions",
      key: openai,
      models: [process.env.BAKEN_MODEL || "gpt-4o-mini"],
    });
  if (lovable)
    targets.push({
      url: "https://ai.gateway.lovable.dev/v1/chat/completions",
      key: lovable,
      models: [
        process.env.BAKEN_MODEL || "google/gemini-3.8-flash",
        "google/gemini-3-flash-preview",
        "google/gemini-2.5-flash",
      ],
    });
  for (const t of targets) {
    for (const model of t.models) {
      const res = await fetch(t.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.key}` },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.4,
          response_format: { type: "json_object" },
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        return j.choices?.[0]?.message?.content ?? null;
      }
      if (res.status !== 400 && res.status !== 404) break; // enkel bij onbekend model het volgende proberen
    }
  }
  return null;
}

export const Route = createFileRoute("/api/baken")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          baken: "v1",
          model: !!(process.env.OPENAI_API_KEY || process.env.LOVABLE_API_KEY),
        }),
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
        if (!(await isAdmin(token))) return new Response("Unauthorized", { status: 401 });
        if (!process.env.OPENAI_API_KEY && !process.env.LOVABLE_API_KEY)
          return Response.json({ error: "geen model" }, { status: 501 });

        let body: {
          question?: string;
          history?: { role: string; content: string }[];
          context?: unknown;
        };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "ongeldige JSON" }, { status: 400 });
        }
        const q = (body.question ?? "").slice(0, 600);
        if (!q) return Response.json({ error: "vraag ontbreekt" }, { status: 400 });

        const messages = [
          { role: "system", content: SYSTEM },
          {
            role: "system",
            content: `Context (cijfers van nu): ${JSON.stringify(body.context ?? {}).slice(0, 6000)}`,
          },
          ...(body.history ?? [])
            .slice(-6)
            .map((m) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: String(m.content).slice(0, 600),
            })),
          { role: "user", content: q },
        ];
        const raw = await callModel(messages);
        if (!raw) return Response.json({ error: "model gaf geen antwoord" }, { status: 502 });
        try {
          const parsed = JSON.parse(raw) as { say?: string; show?: string[] };
          return Response.json({
            say: String(parsed.say ?? "").slice(0, 800),
            show: (parsed.show ?? []).slice(0, 2),
          });
        } catch {
          return Response.json({ say: raw.slice(0, 800), show: [] });
        }
      },
    },
  },
});
