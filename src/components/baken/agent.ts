/**
 * Baken als echte gesprekspartner: ElevenLabs Agents via WebRTC.
 * De open-source SDK (@elevenlabs/client 1.25.0, MIT) staat zelf-gehost in /public/vendor,
 * zodat er geen derde partij of lockfile-wijziging nodig is. Beurtwissel, onderbreken, echo-
 * onderdrukking en de stem regelt de SDK; Baken levert de cijfers en beelden via de tool "toon".
 */
import { agentOpening, authHeader, toolToon, type Scene } from "./engine";

const SDK_URL = "/vendor/elevenlabs-client-1.25.0.js";

export type AgentConversation = {
  endSession: () => Promise<void>;
  getInputVolume: () => number;
  getOutputVolume: () => number;
  sendUserMessage: (text: string) => void;
  sendContextualUpdate: (text: string) => void;
  setMicMuted: (muted: boolean) => void;
  setVolume: (o: { volume: number }) => void;
};

type Sdk = {
  Conversation: { startSession: (o: Record<string, unknown>) => Promise<AgentConversation> };
};

let sdk: Promise<Sdk> | null = null;
export function loadAgentSdk(): Promise<Sdk> {
  sdk ??= new Promise<Sdk>((resolve, reject) => {
    const w = window as unknown as { ElevenLabsClient?: Sdk };
    if (w.ElevenLabsClient) return resolve(w.ElevenLabsClient);
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => (w.ElevenLabsClient ? resolve(w.ElevenLabsClient) : reject(new Error("sdk")));
    s.onerror = () => reject(new Error("sdk niet geladen"));
    document.head.appendChild(s);
  }).catch((e) => {
    sdk = null;
    throw e;
  });
  return sdk;
}

export type AgentEvents = {
  status: (s: "verbinden" | "verbonden" | "gestopt") => void;
  mode: (m: "speaking" | "listening") => void;
  message: (role: "user" | "agent", text: string) => void;
  scene: (scene: Scene) => void;
  error: (msg: string) => void;
};

/**
 * Er bestaat altijd hoogstens één gesprek. Elke start krijgt een generatienummer; een stop (of een
 * nieuwe start) maakt het vorige ongeldig. Een sessie die pas verbindt nadat ze al gestopt werd,
 * wordt meteen weer afgesloten, en events van een oude sessie bereiken de UI niet meer.
 * Zonder dit kon een tik tijdens "Verbinden…" of snel sluiten-en-openen twee agents tegelijk
 * laten praten, en bleef een half verbonden sessie doorlopen nadat Baken dicht was.
 */
let generation = 0;
let current: AgentConversation | null = null;
let starting: Promise<AgentConversation | null> | null = null;

export class AgentCancelled extends Error {
  constructor() {
    super("gestopt");
  }
}

/** Is er een gesprek bezig of aan het verbinden? */
export const agentBusy = () => !!current || !!starting;

/** Stopt het lopende of verbindende gesprek. Veilig om altijd aan te roepen. */
export function stopAgent(): Promise<void> {
  generation++;
  starting = null;
  const c = current;
  current = null;
  return c ? c.endSession().catch(() => {}) : Promise.resolve();
}

/**
 * Start een gesprek. Geeft null terug als de agent niet beschikbaar is (dan valt Baken terug);
 * gooit AgentCancelled als het gesprek intussen gestopt werd. Een tweede aanroep terwijl er al
 * één verbindt of loopt, start niets nieuws.
 */
export function startAgent(on: AgentEvents): Promise<AgentConversation | null> {
  if (current) return Promise.resolve(current);
  if (starting) return starting;
  const mine = ++generation;
  const live = () => mine === generation;
  const p = (async () => {
    on.status("verbinden");
    const [lib, tokenRes, opening] = await Promise.all([
      loadAgentSdk(),
      fetch("/api/baken-agent", { method: "POST", headers: await authHeader() }),
      agentOpening(),
    ]);
    if (!live()) throw new AgentCancelled();
    if (!tokenRes.ok) {
      console.warn("baken-agent", tokenRes.status, await tokenRes.text().catch(() => ""));
      return null;
    }
    const { token } = (await tokenRes.json()) as { token?: string };
    if (!token) return null;
    if (!live()) throw new AgentCancelled();
    on.scene(opening.scene);

    const c = await lib.Conversation.startSession({
      conversationToken: token,
      connectionType: "webrtc",
      useWakeLock: true,
      dynamicVariables: { begroeting: opening.begroeting, stand: opening.stand },
      clientTools: {
        toon: async (q: { onderwerp?: string; site?: string }) => {
          const { scene, facts } = await toolToon(q?.onderwerp ?? "", q?.site);
          if (scene && live()) on.scene(scene);
          return JSON.stringify(facts);
        },
      },
      onConnect: () => live() && on.status("verbonden"),
      onDisconnect: () => {
        if (!live()) return;
        current = null;
        on.status("gestopt");
      },
      onModeChange: ({ mode }: { mode: "speaking" | "listening" }) => live() && on.mode(mode),
      onMessage: ({
        message,
        role,
        source,
      }: {
        message: string;
        role?: string;
        source?: string;
      }) => {
        if (!live()) return;
        const r = role ?? (source === "ai" ? "agent" : "user");
        if (message?.trim()) on.message(r === "user" ? "user" : "agent", message.trim());
      },
      onError: (msg: string) => live() && on.error(String(msg)),
    });
    if (!live()) {
      // Gestopt terwijl we verbonden: deze sessie mag nooit beginnen praten.
      await c.endSession().catch(() => {});
      throw new AgentCancelled();
    }
    current = c;
    return c;
  })();
  starting = p;
  void p
    .finally(() => {
      if (starting === p) starting = null;
    })
    .catch(() => {});
  return p;
}

/**
 * App naar de achtergrond, tab dicht of scherm uit: gesprek stoppen en micro vrijgeven.
 * Eén keer per pagina geregistreerd; de UI krijgt het mee via onHidden.
 */
const hiddenListeners = new Set<() => void>();
let lifecycleWired = false;
export function onAppHidden(fn: () => void): () => void {
  hiddenListeners.add(fn);
  if (!lifecycleWired && typeof document !== "undefined") {
    lifecycleWired = true;
    const hide = () => {
      if (document.visibilityState !== "hidden") return;
      void stopAgent();
      hiddenListeners.forEach((f) => f());
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", () => {
      void stopAgent();
      hiddenListeners.forEach((f) => f());
    });
  }
  return () => hiddenListeners.delete(fn);
}
