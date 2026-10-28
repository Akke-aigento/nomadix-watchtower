import { createFileRoute } from "@tanstack/react-router";

/**
 * Muziek voor de reels van de Nomadix-merken (nomadix-socials/shared/MUZIEK.md).
 * Maakt één instrumentaal nummer met ElevenLabs Music (sleutel ELEVENLABS_MUSIC_API_KEY, anders die van Baken) en
 * zet het in de publieke bucket "social-music". De sleutel verlaat de server nooit.
 *
 * Beveiligd met x-cron-secret; bedoeld om vanuit SQL (net.http_post) aan te roepen.
 * Body: { name: "loveke/warm-zachte-ochtend", prompt: "...", length_ms?: 30000, model?: "music_v2_5" }
 * Antwoord: { path, url, bytes, song_id } of { error }.
 */
const BUCKET = "social-music";
const MODELS = new Set(["music_v1", "music_v2", "music_v2_5"]);

export const Route = createFileRoute("/api/public/music-compose")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret");
        const { isValidCronSecret } = await import("@/lib/cron-secret.server");
        if (!provided || !(await isValidCronSecret(provided))) return new Response("Unauthorized", { status: 401 });

        let input: { name?: string; prompt?: string; length_ms?: number; model?: string };
        try {
          input = await request.json();
        } catch {
          return Response.json({ error: "ongeldige JSON" }, { status: 400 });
        }
        const name = (input.name ?? "").trim();
        const prompt = (input.prompt ?? "").trim();
        if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(name)) {
          return Response.json({ error: "name moet <merk>/<bestandsnaam> zijn (kleine letters, cijfers, koppeltekens)" }, { status: 400 });
        }
        if (!prompt || prompt.length > 2000) return Response.json({ error: "prompt ontbreekt of is te lang" }, { status: 400 });
        const lengthMs = Math.min(Math.max(Math.round(input.length_ms ?? 30000), 10000), 60000);
        const model = MODELS.has(input.model ?? "") ? input.model! : "music_v2_5";

        const { elevenKey } = await import("@/lib/baken-auth.server");
        const key = process.env.ELEVENLABS_MUSIC_API_KEY || elevenKey();
        if (!key) return Response.json({ error: "geen ElevenLabs-sleutel in Watchtower" }, { status: 500 });

        const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192", {
          method: "POST",
          headers: { "xi-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, music_length_ms: lengthMs, model_id: model, force_instrumental: true }),
          signal: AbortSignal.timeout(240_000),
        });
        if (!res.ok) {
          const text = await res.text();
          return Response.json({ error: `ElevenLabs ${res.status}: ${text.slice(0, 400)}` }, { status: 502 });
        }
        const audio = new Uint8Array(await res.arrayBuffer());
        if (audio.byteLength < 10_000) return Response.json({ error: "leeg of te klein antwoord van ElevenLabs" }, { status: 502 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: buckets } = await supabaseAdmin.storage.listBuckets();
        if (!buckets?.some((b) => b.name === BUCKET)) {
          const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
            public: true,
            allowedMimeTypes: ["audio/mpeg"],
            fileSizeLimit: 10 * 1024 * 1024,
          });
          if (error && !/exists/i.test(error.message)) return Response.json({ error: `bucket: ${error.message}` }, { status: 500 });
        }

        const path = `${name}.mp3`;
        const { error: upErr } = await supabaseAdmin.storage
          .from(BUCKET)
          .upload(path, audio, { contentType: "audio/mpeg", upsert: false });
        if (upErr) return Response.json({ error: `upload: ${upErr.message}` }, { status: 409 });

        const url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        return Response.json({ path, url, bytes: audio.byteLength, song_id: res.headers.get("song-id"), model });
      },
    },
  },
});
