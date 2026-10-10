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

/** Start een gesprek. Geeft null terug als de agent niet beschikbaar is (dan valt Baken terug). */
export async function startAgent(on: AgentEvents): Promise<AgentConversation | null> {
  on.status("verbinden");
  const [lib, tokenRes, opening] = await Promise.all([
    loadAgentSdk(),
    fetch("/api/baken-agent", { method: "POST", headers: await authHeader() }),
    agentOpening(),
  ]);
  if (!tokenRes.ok) {
    console.warn("baken-agent", tokenRes.status, await tokenRes.text().catch(() => ""));
    return null;
  }
  const { token } = (await tokenRes.json()) as { token?: string };
  if (!token) return null;
  on.scene(opening.scene);

  return lib.Conversation.startSession({
    conversationToken: token,
    connectionType: "webrtc",
    useWakeLock: true,
    dynamicVariables: { begroeting: opening.begroeting, stand: opening.stand },
    clientTools: {
      toon: async (p: { onderwerp?: string; site?: string }) => {
        const { scene, facts } = await toolToon(p?.onderwerp ?? "", p?.site);
        if (scene) on.scene(scene);
        return JSON.stringify(facts);
      },
    },
    onConnect: () => on.status("verbonden"),
    onDisconnect: () => on.status("gestopt"),
    onModeChange: ({ mode }: { mode: "speaking" | "listening" }) => on.mode(mode),
    onMessage: ({ message, role, source }: { message: string; role?: string; source?: string }) => {
      const r = role ?? (source === "ai" ? "agent" : "user");
      if (message?.trim()) on.message(r === "user" ? "user" : "agent", message.trim());
    },
    onError: (msg: string) => on.error(String(msg)),
  });
}
