import { createFileRoute } from "@tanstack/react-router";

/**
 * Baken luistert: opname → tekst.
 * 1. ElevenLabs Speech-to-Text als die sleutel in het project zit (beste kwaliteit).
 * 2. Anders het taalmodel via de Lovable AI Gateway (Gemini hoort audio). De client stuurt dan WAV.
 * Enkel voor Watchtower-admins; met x-cron-secret mag een zelftest (geen neveneffect).
 */
const STT_PROMPT =
  "Schrijf letterlijk uit wat er in deze opname gezegd wordt (Vlaams/Nederlands, soms Engelse woorden). " +
  "Geef ENKEL de uitgeschreven tekst terug, zonder aanhalingstekens of uitleg. " +
  "Hoor je geen spraak, geef dan een lege tekst terug.";

async function viaEleven(key: string, audio: Blob) {
  const form = new FormData();
  const ext = (audio.type || "").includes("wav")
    ? "wav"
    : (audio.type || "").includes("mp4")
      ? "mp4"
      : "webm";
  form.append("file", audio, `baken.${ext}`);
  form.append("model_id", process.env.BAKEN_STT_MODEL || "scribe_v1");
  form.append("language_code", "nld");
  form.append("tag_audio_events", "false");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { text?: string };
  return (j.text ?? "").trim();
}

async function viaGateway(key: string, audio: Blob) {
  if (!(audio.type || "").includes("wav")) throw new Error("gateway verwacht WAV");
  const b64 = Buffer.from(await audio.arrayBuffer()).toString("base64");
  let last = "";
  for (const model of [
    process.env.BAKEN_STT_GATEWAY_MODEL || "google/gemini-2.5-flash",
    "google/gemini-3-flash-preview",
  ]) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: STT_PROMPT },
              { type: "input_audio", input_audio: { data: b64, format: "wav" } },
            ],
          },
        ],
      }),
    });
    if (res.ok) {
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return (j.choices?.[0]?.message?.content ?? "")
        .trim()
        .replace(/^["'“”]+|["'“”]+$/g, "")
        .trim();
    }
    last = `Gateway ${res.status}: ${(await res.text()).slice(0, 200)}`;
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(last || "gateway gaf geen antwoord");
}

export const Route = createFileRoute("/api/baken-stt")({
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

        let audio: Blob;
        const ct = request.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          // zelftest: {"wav_b64": "..."}
          const j = (await request.json()) as { wav_b64?: string };
          audio = new Blob([Buffer.from(j.wav_b64 ?? "", "base64")], { type: "audio/wav" });
        } else {
          audio = await request.blob();
          if (!audio.type && ct) audio = new Blob([await audio.arrayBuffer()], { type: ct });
        }
        if (!audio.size) return Response.json({ error: "lege opname" }, { status: 400 });
        if (audio.size > 8_000_000)
          return Response.json({ error: "opname te lang" }, { status: 413 });

        const eleven = elevenKey();
        const lovable = process.env.LOVABLE_API_KEY;
        try {
          if (eleven)
            return Response.json({ text: await viaEleven(eleven, audio), via: "elevenlabs" });
          if (lovable)
            return Response.json({ text: await viaGateway(lovable, audio), via: "model" });
          return Response.json({ error: "geen spraakherkenning ingesteld" }, { status: 501 });
        } catch (e) {
          // ElevenLabs faalt → nog proberen via het model.
          if (eleven && lovable && (audio.type || "").includes("wav")) {
            try {
              return Response.json({ text: await viaGateway(lovable, audio), via: "model" });
            } catch {
              /* hieronder melden */
            }
          }
          return Response.json(
            { error: e instanceof Error ? e.message : String(e) },
            { status: 502 },
          );
        }
      },
    },
  },
});
