/**
 * Baken — stem en oren.
 * Spreken: ElevenLabs via /api/baken-tts als die sleutel er is; anders de stem van het toestel
 * (zin per zin, met een waakhond zodat het gesprek nooit blijft hangen).
 * Luisteren: altijd microfoon-opname (MediaRecorder; werkt ook in de iOS-beginschermapp, waar
 * de spraakherkenning van de browser niet werkt). De opname wordt WAV (16 kHz mono) en gaat
 * naar /api/baken-stt (ElevenLabs of het taalmodel). Stilte-detectie past zich aan het
 * achtergrondgeluid aan.
 */
import { authHeader, capabilities } from "./engine";

type LevelFn = (v: number) => void;
type SpeakEvents = { start: () => void; level: LevelFn; end: () => void };
export type ListenEvents = {
  level: LevelFn;
  /** Opname klaar, tekst wordt opgehaald. */
  thinking?: () => void;
  heard: (text: string) => void;
  /** Niets gehoord (stilte). */
  empty: () => void;
  error: (msg: string) => void;
};

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

function pickVoice(): SpeechSynthesisVoice | undefined {
  const vs = window.speechSynthesis?.getVoices() ?? [];
  const nl = vs.filter((x) => x.lang.replace("_", "-").toLowerCase().startsWith("nl"));
  const score = (v: SpeechSynthesisVoice) =>
    (v.lang.toLowerCase().includes("be") ? 4 : 0) +
    (/premium|enhanced|natural|neural/i.test(v.name) ? 3 : 0) +
    (/ellen|xander|claire|google/i.test(v.name) ? 1 : 0);
  return nl.sort((a, b) => score(b) - score(a))[0];
}

/** Opname (webm/mp4) → WAV 16 kHz mono, zodat elke spraakherkenning hem leest. */
async function toWav(blob: Blob, ctx: AudioContext): Promise<Blob> {
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  const rate = 16000;
  const len = Math.max(1, Math.ceil(decoded.duration * rate));
  const off = new OfflineAudioContext(1, len, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

class Voice {
  private ctx: AudioContext | null = null;
  private audio: HTMLAudioElement | null = null;
  private analyser: AnalyserNode | null = null;
  private wired = false;
  private raf = 0;
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private stopListening: (() => void) | null = null;
  /** Elke speak/listen krijgt een nummer; oude callbacks van een afgebroken beurt doen niets meer. */
  private turn = 0;

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
      if (!this.audio.src || this.audio.paused) {
        this.audio.src = SILENT_WAV;
        void this.audio.play().catch(() => {});
      }
      // iOS: de toestelstem ontgrendelen met een stille uitspraak binnen de tik.
      if (window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
        window.speechSynthesis.getVoices();
      }
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
    this.turn++;
    cancelAnimationFrame(this.raf);
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    this.stopListening?.();
  }

  async speak(text: string, on: SpeakEvents) {
    this.stop();
    const me = this.turn;
    const { voice } = await capabilities();
    if (me !== this.turn) return;
    if (voice && this.audio && this.ctx) {
      try {
        const res = await fetch("/api/baken-tts", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({ text }),
        });
        if (me !== this.turn) return;
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
            if (me === this.turn) on.end();
          };
          await a.play();
          on.start();
          if (this.analyser) this.meter(this.analyser, on.level);
          return;
        }
      } catch {
        /* val terug op de toestelstem */
      }
    }
    if (me === this.turn) this.speakDevice(text, on, me);
  }

  /** Toestelstem, zin per zin (lange uitspraken worden op sommige toestellen afgekapt). */
  private speakDevice(text: string, on: SpeakEvents, me: number) {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return on.end();
    const parts = text
      .match(/[^.!?]+[.!?]*/g)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? [text];
    const v = pickVoice();
    let started = false;
    let i = 0;
    // Waakhond: start de stem niet binnen 2,5 s (iOS blokkeert soms), ga dan gewoon verder.
    const guard = window.setTimeout(() => {
      if (!started && me === this.turn) {
        synth.cancel();
        on.level(0);
        on.end();
      }
    }, 2500);
    const next = () => {
      if (me !== this.turn) return;
      if (i >= parts.length) {
        on.level(0);
        on.end();
        return;
      }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      if (v) u.voice = v;
      u.lang = v?.lang ?? "nl-BE";
      u.rate = 1.04;
      u.onstart = () => {
        if (!started) {
          started = true;
          window.clearTimeout(guard);
          on.start();
        }
      };
      u.onboundary = () => {
        on.level(0.7);
        window.setTimeout(() => on.level(0.2), 110);
      };
      u.onend = next;
      u.onerror = next;
      synth.speak(u);
    };
    synth.cancel();
    next();
  }

  canListen() {
    if (typeof window === "undefined") return false;
    return (
      (!!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined") ||
      !!(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );
  }

  /** Luistert tot er na het spreken ~1,2 s stilte is (max 25 s) en geeft de tekst terug. */
  async listen(on: ListenEvents) {
    this.stop();
    const me = this.turn;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
      return this.listenBrowser(on);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      return on.error(
        "Ik mag je microfoon niet gebruiken. Geef Watchtower toegang tot de microfoon in je instellingen.",
      );
    }
    if (me !== this.turn) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      return;
    }
    if (!this.ctx) this.unlock();
    const ctx = this.ctx;
    if (!ctx) return on.error("Geen audio beschikbaar op dit toestel. Typ je vraag.");
    await ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(this.stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const type =
      ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) =>
        MediaRecorder.isTypeSupported?.(t),
      ) ?? "";
    const rec = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.rec = rec;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };

    // Adaptieve drempel: eerst ~350 ms achtergrondgeluid meten.
    let floor = 0;
    let floorN = 0;
    let spoke = false;
    let cancelled = false;
    let quietSince = performance.now();
    const started = performance.now();
    const buf = new Uint8Array(an.fftSize);
    const loop = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) sum += ((b - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (now - started < 350) {
        floor += rms;
        floorN++;
      }
      const base = floorN ? floor / floorN : 0.005;
      const threshold = Math.max(0.012, base * 2.2);
      on.level(Math.min(1, rms * 8));
      if (now - started > 350 && rms > threshold) {
        spoke = true;
        quietSince = now;
      }
      if (
        (spoke && now - quietSince > 1200) ||
        now - started > 25000 ||
        (!spoke && now - started > 9000)
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
    this.stopListening = () => {
      cancelled = true;
      finish();
    };
    rec.onstop = async () => {
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.stopListening = null;
      on.level(0);
      if (cancelled) return;
      if (!spoke || !chunks.length) return on.empty();
      on.thinking?.();
      const raw = new Blob(chunks, { type: rec.mimeType || type || "audio/mp4" });
      let body: Blob = raw;
      try {
        body = await toWav(raw, ctx);
      } catch {
        /* stuur het origineel; ElevenLabs leest dat ook */
      }
      try {
        const res = await fetch("/api/baken-stt", {
          method: "POST",
          headers: { "Content-Type": body.type || "audio/mp4", ...(await authHeader()) },
          body,
        });
        const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!res.ok) {
          console.warn("baken-stt", res.status, j.error);
          return on.error("Ik kon je niet verstaan, er liep iets mis met de spraakherkenning.");
        }
        if (j.text) on.heard(j.text);
        else on.empty();
      } catch {
        on.error("Ik kon je niet verstaan. Probeer het nog eens.");
      }
    };
    rec.start(250);
    loop();
  }

  /** Enkel als opnemen niet kan (oude browsers). */
  private listenBrowser(on: ListenEvents) {
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
    r.onend = () => (got ? on.heard(got) : on.empty());
    r.onerror = () => on.error("Spreken lukt niet in deze browser. Typ je vraag.");
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
