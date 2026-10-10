import { createFileRoute } from "@tanstack/react-router";

/** Baken spreekt: tekst → ElevenLabs-stem (mp3). Enkel voor Watchtower-admins. */
export const Route = createFileRoute("/api/baken-tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isBakenAdmin, elevenKey } = await import("@/lib/baken-auth.server");
        if (!(await isBakenAdmin(request))) return new Response("Unauthorized", { status: 401 });
        const key = elevenKey();
        if (!key) return Response.json({ error: "geen ElevenLabs-sleutel" }, { status: 501 });
        let text = "";
        try {
          text = String(((await request.json()) as { text?: string }).text ?? "").slice(0, 900);
        } catch {
          return Response.json({ error: "ongeldige JSON" }, { status: 400 });
        }
        if (!text) return Response.json({ error: "tekst ontbreekt" }, { status: 400 });
        const voice = process.env.BAKEN_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`,
          {
            method: "POST",
            headers: {
              "xi-api-key": key,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
            },
            body: JSON.stringify({
              text,
              model_id: process.env.BAKEN_TTS_MODEL || "eleven_multilingual_v2",
              language_code: "nl",
              voice_settings: {
                stability: 0.45,
                similarity_boost: 0.8,
                style: 0.25,
                use_speaker_boost: true,
              },
            }),
          },
        );
        if (!res.ok)
          return Response.json(
            { error: `ElevenLabs ${res.status}`, detail: (await res.text()).slice(0, 300) },
            { status: 502 },
          );
        return new Response(res.body, {
          headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
