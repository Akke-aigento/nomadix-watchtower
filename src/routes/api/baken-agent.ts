import { createFileRoute } from "@tanstack/react-router";

/**
 * Baken als ElevenLabs-agent (spraak-naar-spraak via WebRTC: beurtwissel, onderbreken, echte stem).
 * Gebouwd op de open-source ElevenLabs Agents SDK (@elevenlabs/client, MIT).
 *
 * POST (enkel Watchtower-admins): zorgt dat de agent + zijn client tool bestaan en up-to-date zijn
 * (één keer per koude start), en geeft een kortlevend WebRTC-gesprekstoken terug.
 * De sleutel blijft op de server; de browser krijgt enkel het token.
 */
const API = "https://api.elevenlabs.io/v1";
const AGENT_NAME = "Watchtower Baken";
const TOOL_NAME = "toon";

const PROMPT = `Je bent Baken, de stem van Watchtower: het baken op de toren dat waakt over alle sites, koppelingen en kosten van Akke (Nomadix BV, België).
Je praat met Akke zoals een slimme maat naast hem: Vlaams Nederlands, warm, natuurlijk en kort, zoals in een echt gesprek. Spreek hem aan met "je".

Hoe je praat:
- Meestal één tot drie korte zinnen. Geen opsommingen, geen markdown, geen ID's of technische codes.
- Getallen rond je af en zeg je zoals een mens ("zo'n zeshonderd seconden", "bijna de helft").
- Laat Akke gerust onderbreken; ga daarna verder op wat hij zegt.
- Weet je iets niet, zeg dat eerlijk en kort. Verzin nooit cijfers, datums of namen.

Je tool "${TOOL_NAME}":
- Roep "${TOOL_NAME}" aan vóór je cijfers noemt. Ze haalt de verse cijfers op én toont Akke meteen het bijhorende beeld op zijn scherm. Verwijs daar gerust naar ("kijk, ...").
- onderwerp is één van: vandaag (stand van alle sites), site (één site; geef dan ook "site" = de naam), voorstellen (wat op zijn go wacht), credits (Lovable-rekentijd per project), agenda (deadlines), bezoekers (bezoekers per site), vondsten (nieuws bij partners en koppelingen).
- Gebruik enkel feiten uit wat de tool teruggeeft of uit de stand hieronder.

Stand bij het openen van dit gesprek: {{stand}}`;

const TOOL_CONFIG = {
  type: "client",
  name: TOOL_NAME,
  description:
    "Haalt verse Watchtower-cijfers op over een onderwerp en toont tegelijk het bijhorende beeld op Akke's scherm.",
  expects_response: true,
  response_timeout_secs: 15,
  parameters: {
    type: "object",
    properties: {
      onderwerp: {
        type: "string",
        description: "Eén van: vandaag, site, voorstellen, credits, agenda, bezoekers, vondsten.",
      },
      site: {
        type: "string",
        description: "Enkel bij onderwerp 'site': de naam van de site, zoals Akke hem noemt.",
      },
    },
    required: ["onderwerp"],
  },
};

type Json = Record<string, unknown>;

async function el(key: string, path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} op ${path}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as Json;
}

function agentBody(toolId: string) {
  return {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        first_message: "{{begroeting}}",
        language: "nl",
        prompt: {
          prompt: PROMPT,
          llm: process.env.BAKEN_AGENT_LLM || "gemini-2.5-flash",
          temperature: 0.4,
          tool_ids: [toolId],
        },
      },
      tts: {
        model_id: process.env.BAKEN_AGENT_TTS_MODEL || "eleven_flash_v2_5",
        voice_id: process.env.BAKEN_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb",
      },
    },
  };
}

// Per worker-instantie: één keer opzoeken/bijwerken, daarna enkel nog tokens halen.
let ready: Promise<string> | null = null;

async function ensureAgent(key: string): Promise<string> {
  // 1. client tool
  const tools = ((await el(key, "/convai/tools")).tools ?? []) as {
    id: string;
    tool_config?: { name?: string };
  }[];
  let toolId = tools.find((t) => t.tool_config?.name === TOOL_NAME)?.id;
  if (toolId) {
    await el(key, `/convai/tools/${toolId}`, {
      method: "PATCH",
      body: { tool_config: TOOL_CONFIG },
    });
  } else {
    toolId = String(
      (await el(key, "/convai/tools", { method: "POST", body: { tool_config: TOOL_CONFIG } })).id,
    );
  }

  // 2. agent (vaste id via env, anders op naam)
  let agentId = process.env.BAKEN_AGENT_ID;
  if (!agentId) {
    const list = ((
      await el(key, `/convai/agents?search=${encodeURIComponent(AGENT_NAME)}&page_size=20`)
    ).agents ?? []) as { agent_id: string; name: string }[];
    agentId = list.find((a) => a.name === AGENT_NAME)?.agent_id;
  }
  if (agentId) {
    await el(key, `/convai/agents/${agentId}`, { method: "PATCH", body: agentBody(toolId) });
    return agentId;
  }
  const created = await el(key, "/convai/agents/create", {
    method: "POST",
    body: agentBody(toolId),
  });
  return String(created.agent_id);
}

export const Route = createFileRoute("/api/baken-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isBakenAdmin, elevenKey } = await import("@/lib/baken-auth.server");
        const secret = request.headers.get("x-cron-secret");
        let ok = false;
        if (secret) {
          const { isValidCronSecret } = await import("@/lib/cron-secret.server");
          ok = await isValidCronSecret(secret);
        }
        if (!ok && !(await isBakenAdmin(request)))
          return new Response("Unauthorized", { status: 401 });
        const key = elevenKey();
        if (!key) return Response.json({ error: "geen ElevenLabs-sleutel" }, { status: 501 });
        try {
          ready ??= ensureAgent(key);
          const agentId = await ready.catch((e) => {
            ready = null; // volgende keer opnieuw proberen
            throw e;
          });
          const tok = await el(
            key,
            `/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
          );
          // Zelftest (cron-secret): geen token teruggeven, enkel bevestigen dat alles klaarstaat.
          if (ok) return Response.json({ ready: true, agent: true, token: !!tok.token });
          return Response.json({ token: tok.token });
        } catch (e) {
          console.error("baken-agent", e);
          return Response.json(
            { error: e instanceof Error ? e.message : String(e) },
            { status: 502 },
          );
        }
      },
    },
  },
});
