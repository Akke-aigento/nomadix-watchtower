import { createFileRoute } from "@tanstack/react-router";

/** Baken luistert: opname (webm/mp4) → tekst via ElevenLabs Speech-to-Text. Enkel voor Watchtower-admins. */
export const Route = createFileRoute("/api/baken-stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isBakenAdmin, elevenKey } = await import("@/lib/baken-auth.server");
        if (!(await isBakenAdmin(request))) return new Response("Unauthorized", { status: 401 });
        const key = elevenKey();
        if (!key) return Response.json({ error: "geen ElevenLabs-sleutel" }, { status: 501 });
        const audio = await request.blob();
        if (!audio.size) return Response.json({ error: "lege opname" }, { status: 400 });
        if (audio.size > 8_000_000)
          return Response.json({ error: "opname te lang" }, { status: 413 });
        const form = new FormData();
        form.append(
          "file",
          audio,
          `baken.${(audio.type || "audio/webm").includes("mp4") ? "mp4" : "webm"}`,
        );
        form.append("model_id", process.env.BAKEN_STT_MODEL || "scribe_v1");
        form.append("language_code", "nld");
        form.append("tag_audio_events", "false");
        const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
          method: "POST",
          headers: { "xi-api-key": key },
          body: form,
        });
        if (!res.ok)
          return Response.json(
            { error: `ElevenLabs ${res.status}`, detail: (await res.text()).slice(0, 300) },
            { status: 502 },
          );
        const j = (await res.json()) as { text?: string };
        return Response.json({ text: (j.text ?? "").trim() });
      },
    },
  },
});
