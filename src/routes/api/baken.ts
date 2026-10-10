import { createFileRoute } from "@tanstack/react-router";

/**
 * Baken — vrije vragen naar een taalmodel.
 * Enkel voor ingelogde Watchtower-admins (Bearer-token). De client stuurt de vraag + een compacte
 * context met de cijfers; het model antwoordt kort in het Vlaams en kiest welke beelden getoond worden.
 * Provider: OPENAI_API_KEY (als die er is), anders LOVABLE_API_KEY (Lovable AI Gateway).
 * Geen sleutel → 501, dan antwoordt Baken lokaal (0 credits).
 */
const SYSTEM = `Je bent Baken, de stem van Watchtower: het baken op de toren dat over alle sites en koppelingen van Akke (Nomadix BV) waakt.
Je praat met Akke zoals een slimme maat naast hem: Vlaams, warm, natuurlijk en kort, alsof je het hardop zegt. Spreek hem aan met "je".
Regels:
- Maximaal 3 korte zinnen, geschikt om voor te lezen. Geen opsommingen, geen markdown, geen emoji, geen technische codes of ID's.
- Rond getallen af en zeg ze zoals een mens ("zo'n 600 seconden", "bijna de helft").
- Gebruik enkel feiten uit de context; verzin niets. Weet je het niet, zeg dat eerlijk en kort.
- Er wordt naast je antwoord een beeld getoond (zie "beeld" in de context); verwijs er gerust naar ("kijk, ...").
- Eindig waar nuttig met één concrete volgende stap of vraag.
Antwoord ALTIJD als JSON: {"say": "<tekst>", "show": [<0-2 uit "vandaag","credits","agenda","voorstellen","bezoekers","vondsten">]}.`;

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
      GET: async () => {
        const { elevenKey } = await import("@/lib/baken-auth.server");
        return Response.json({
          baken: "v4",
          model: process.env.OPENAI_API_KEY
            ? "openai"
            : process.env.LOVABLE_API_KEY
              ? "lovable"
              : null,
          voice: elevenKey() ? "elevenlabs" : null,
          listen: elevenKey() ? "elevenlabs" : process.env.LOVABLE_API_KEY ? "model" : null,
          agent: elevenKey() ? "elevenlabs" : null,
        });
      },
      POST: async ({ request }) => {
        const { isBakenAdmin } = await import("@/lib/baken-auth.server");
        if (!(await isBakenAdmin(request))) return new Response("Unauthorized", { status: 401 });
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
            content: `Context (cijfers van nu): ${JSON.stringify(body.context ?? {}).slice(0, 9000)}`,
          },
          ...(body.history ?? []).slice(-6).map((m) => ({
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
