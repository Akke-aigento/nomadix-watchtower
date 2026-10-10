/**
 * Baken — stem en oren.
 * Spreken: ElevenLabs via /api/baken-tts, afgespeeld via één audio-element dat bij de eerste tik
 * wordt "ontgrendeld" (iOS speelt anders geen geluid af na een netwerkcall). Het baken beweegt
 * mee op het echte volume (Web Audio-analyser).
 * Luisteren: microfoon-opname (MediaRecorder) met stilte-detectie, omgezet via /api/baken-stt.
 * Valt terug op de stem en spraakherkenning van de browser als ElevenLabs er niet is.
 */
import { authHeader, capabilities } from "./engine";

type LevelFn = (v: number) => void;

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

class Voice {
  private ctx: AudioContext | null = null;
  private audio: HTMLAudioElement | null = null;
  private analyser: AnalyserNode | null = null;
  private wired = false;
  private raf = 0;
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private stopListening: (() => void) | null = null;

  /** Moet binnen een tik (gebruikersgebaar) aangeroepen worden. */
  unlock() {
    if (typeof window === "undefined") return;
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx ??= new AC();
      void this.ctx.resume();
      if (!this.audio) {
        this.audio = new Audio();
        this.audio.setAttribute("playsinline", "true");
        this.audio.preload = "auto";
      }
      this.audio.src = SILENT_WAV;
      void this.audio.play().catch(() => {});
      // iOS: ook de browserstem ontgrendelen met een lege uitspraak.
      if (window.speechSynthesis) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    } catch {
      /* geen audio mogelijk */
    }
  }

  private meter(analyser: AnalyserNode, onLevel: LevelFn) {
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) sum += ((b - 128) / 128) ** 2;
      onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      this.raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.raf);
    tick();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
    }
    window.speechSynthesis?.cancel();
    this.stopListening?.();
  }

  async speak(text: string, on: { start: () => void; level: LevelFn; end: () => void }) {
    this.stop();
    const { voice } = await capabilities();
    if (voice && this.audio && this.ctx) {
      try {
        const res = await fetch("/api/baken-tts", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          const url = URL.createObjectURL(await res.blob());
          const a = this.audio;
          if (!this.wired) {
            const src = this.ctx.createMediaElementSource(a);
            this.analyser = this.ctx.createAnalyser();
            this.analyser.fftSize = 512;
            src.connect(this.analyser);
            this.analyser.connect(this.ctx.destination);
            this.wired = true;
          }
          await this.ctx.resume();
          a.src = url;
          a.onended = () => {
            cancelAnimationFrame(this.raf);
            URL.revokeObjectURL(url);
            on.level(0);
            on.end();
          };
          await a.play();
          on.start();
          if (this.analyser) this.meter(this.analyser, on.level);
          return;
        }
      } catch {
        /* val terug op de browserstem */
      }
    }
    this.speakBrowser(text, on);
  }

  private speakBrowser(text: string, on: { start: () => void; level: LevelFn; end: () => void }) {
    if (typeof window === "undefined" || !window.speechSynthesis) return on.end();
    const u = new SpeechSynthesisUtterance(text);
    const vs = window.speechSynthesis.getVoices();
    const v = vs.find((x) => x.lang === "nl-BE") ?? vs.find((x) => x.lang.startsWith("nl"));
    if (v) u.voice = v;
    u.lang = v?.lang ?? "nl-BE";
    u.onstart = on.start;
    u.onboundary = () => {
      on.level(0.7);
      window.setTimeout(() => on.level(0.2), 110);
    };
    u.onend = () => {
      on.level(0);
      on.end();
    };
    u.onerror = () => on.end();
    window.speechSynthesis.speak(u);
  }

  canListen() {
    if (typeof window === "undefined") return false;
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }

  /** Luistert tot er na het spreken ~1,3 s stilte is (max 20 s), en geeft de tekst terug. */
  async listen(on: {
    level: LevelFn;
    heard: (text: string) => void;
    done: () => void;
    error: (msg: string) => void;
  }) {
    this.stop();
    const { voice } = await capabilities();
    if (!voice) return this.listenBrowser(on);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      return on.error(
        "Ik mag je microfoon niet gebruiken. Geef Watchtower toegang in je instellingen.",
      );
    }
    if (!this.ctx) this.unlock();
    const ctx = this.ctx;
    if (!ctx) return on.error("Geen audio beschikbaar op dit toestel. Typ je vraag.");
    await ctx.resume();
    const src = ctx.createMediaStreamSource(this.stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const type =
      ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) =>
        MediaRecorder.isTypeSupported?.(t),
      ) ?? "";
    const rec = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.rec = rec;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    let spoke = false;
    let quietSince = performance.now();
    const started = performance.now();
    const buf = new Uint8Array(an.fftSize);
    const loop = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) sum += ((b - 128) / 128) ** 2;
      const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 6);
      on.level(lvl);
      const now = performance.now();
      if (lvl > 0.12) {
        spoke = true;
        quietSince = now;
      }
      if (
        (spoke && now - quietSince > 1300) ||
        now - started > 20000 ||
        (!spoke && now - started > 8000)
      ) {
        finish();
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    const finish = () => {
      cancelAnimationFrame(this.raf);
      if (rec.state !== "inactive") rec.stop();
    };
    this.stopListening = finish;
    rec.onstop = async () => {
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.stopListening = null;
      on.level(0);
      if (!spoke || !chunks.length) return on.done();
      try {
        const res = await fetch("/api/baken-stt", {
          method: "POST",
          headers: { "Content-Type": rec.mimeType || "audio/webm", ...(await authHeader()) },
          body: new Blob(chunks, { type: rec.mimeType || "audio/webm" }),
        });
        const j = (await res.json()) as { text?: string };
        if (j.text) on.heard(j.text);
        else on.done();
      } catch {
        on.error("Ik kon je niet verstaan. Probeer het nog eens.");
      }
    };
    rec.start(250);
    loop();
  }

  private listenBrowser(on: {
    level: LevelFn;
    heard: (text: string) => void;
    done: () => void;
    error: (msg: string) => void;
  }) {
    const W = window as unknown as {
      SpeechRecognition?: new () => SpeechRec;
      webkitSpeechRecognition?: new () => SpeechRec;
    };
    const C = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!C) return on.error("Spreken lukt niet in deze browser. Typ je vraag.");
    const r = new C();
    r.lang = "nl-BE";
    r.interimResults = false;
    let got = "";
    r.onresult = (e) => {
      got = Array.from(e.results)
        .map((x) => x[0].transcript)
        .join(" ");
      on.level(0.6);
    };
    r.onend = () => (got ? on.heard(got) : on.done());
    r.onerror = () => on.done();
    this.stopListening = () => r.stop();
    r.start();
  }
}

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

export const voice = new Voice();
