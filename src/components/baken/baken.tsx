import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowUp, Mic, MicOff, Volume2, VolumeX, X } from "lucide-react";
import { ask, greet, type BakenReply } from "./engine";
import { SceneView } from "./scenes";
import { voice } from "./voice";
import { ProposalSheet } from "@/components/proposal-detail";
import { cn } from "@/lib/utils";

type Mood = "rust" | "luistert" | "denkt" | "praat";
type Turn = { id: number; role: "user" | "baken"; text: string; reply?: BakenReply };

const SUGGESTIONS = [
  "Wat moet ik vandaag weten?",
  "Wat wacht op mijn go?",
  "Waar gaan de credits naartoe?",
  "Wat komt eraan?",
  "Hoeveel bezoekers deze week?",
  "Hoe doet VanXcel het?",
];

const Ctx = createContext<{ open: () => void }>({ open: () => {} });
export const useBaken = () => useContext(Ctx);

// ---------- het hart: een levend baken ----------

export function BakenCore({
  mood,
  level = 0,
  className,
}: {
  mood: Mood;
  level?: number;
  className?: string;
}) {
  const speed = mood === "denkt" ? 1.1 : mood === "praat" ? 2.2 : mood === "luistert" ? 1.6 : 6;
  const glow =
    mood === "luistert"
      ? "#fbbf24"
      : mood === "praat"
        ? "#22d3ee"
        : mood === "denkt"
          ? "#a78bfa"
          : "#2dd4bf";
  const scale = 1 + (mood === "praat" ? level * 0.12 : mood === "luistert" ? level * 0.18 : 0);
  return (
    <div className={cn("relative aspect-square", className)} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="absolute inset-[18%] rounded-full border"
          style={{
            borderColor: `${glow}55`,
            animation: `wt-ring ${speed * 1.4}s ease-out ${i * speed * 0.35}s infinite`,
          }}
        />
      ))}
      <span
        className="absolute inset-[12%] rounded-full blur-3xl transition-colors duration-700"
        style={{ background: `${glow}30` }}
      />
      {/* draaiende lichtbundel, zoals een vuurtoren */}
      <span className="absolute inset-[6%] overflow-hidden rounded-full">
        <span
          className="absolute inset-0"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, transparent 300deg, ${glow}22 330deg, ${glow}88 358deg, transparent 360deg)`,
            animation: `wt-sweep ${mood === "rust" ? 7 : 2.4}s linear infinite`,
          }}
        />
      </span>
      <div
        className="absolute inset-0 transition-transform duration-150"
        style={{ transform: `scale(${scale})` }}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
          <defs>
            <linearGradient
              id="bk-g"
              x1="15"
              y1="10"
              x2="85"
              y2="90"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor="#14b8a6" />
              <stop offset=".5" stopColor="#06b6d4" />
              <stop offset="1" stopColor="#0ea5e9" />
            </linearGradient>
            <mask id="bk-m">
              <rect width="100" height="100" fill="#fff" />
              <circle cx="84.4" cy="30.5" r="9.5" fill="#000" />
            </mask>
          </defs>
          <path
            d="M50 11 L84.4 30.5 L84.4 69.5 L50 89 L15.6 69.5 L15.6 30.5 Z"
            fill="rgb(11 26 46 / 55%)"
            stroke="url(#bk-g)"
            strokeWidth="3"
            strokeLinejoin="round"
            mask="url(#bk-m)"
          />
          <circle cx="84.4" cy="30.5" r="5.4" fill="#0ea5e9" />
          <circle
            cx="50"
            cy="50"
            r="22"
            fill="none"
            stroke="url(#bk-g)"
            strokeOpacity=".3"
            strokeWidth="1"
            strokeDasharray="2 3"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 50 50"
              to="360 50 50"
              dur={`${speed * 3}s`}
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="50" cy="50" r="13.5" fill="none" stroke="url(#bk-g)" strokeWidth="3" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            className="size-[12%] rounded-full transition-colors duration-500"
            style={{
              background: glow,
              boxShadow: `0 0 26px 8px ${glow}99`,
              animation: `wt-breathe ${speed}s ease-in-out infinite`,
            }}
          />
        </span>
      </div>
    </div>
  );
}

// ---------- de ervaring ----------

function BakenExperience({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [mood, setMood] = useState<Mood>("denkt");
  const [level, setLevel] = useState(0);
  const [input, setInput] = useState("");
  const [sound, setSound] = useState(true);
  const [listening, setListening] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const idRef = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  // Gespreksmodus: na elk gesproken antwoord luistert Baken meteen opnieuw.
  const convo = useRef(false);
  const [convoOn, setConvoOn] = useState(false);
  const canListen = typeof window !== "undefined" && voice.canListen();
  const sendRef = useRef<(q: string) => void>(() => {});

  const say = useCallback((text: string) => {
    setTurns((t) => [
      ...t,
      {
        id: idRef.current++,
        role: "baken",
        text,
        reply: { say: text, scenes: [], source: "lokaal" },
      },
    ]);
  }, []);

  const stopConvo = useCallback(() => {
    convo.current = false;
    setConvoOn(false);
  }, []);

  const startListening = useCallback(() => {
    setListening(true);
    setMood("luistert");
    void voice.listen({
      level: setLevel,
      thinking: () => {
        setListening(false);
        setMood("denkt");
      },
      heard: (t) => {
        setListening(false);
        sendRef.current(t);
      },
      empty: () => {
        setListening(false);
        setMood("rust");
        stopConvo();
        setHint("Ik hoorde niks. Tik op het baken als je iets wil vragen.");
      },
      error: (m) => {
        setListening(false);
        setMood("rust");
        stopConvo();
        say(m);
      },
    });
  }, [say, stopConvo]);

  const speak = useCallback(
    (text: string) => {
      if (!soundRef.current) {
        setMood("rust");
        if (convo.current) startListening();
        return;
      }
      void voice.speak(text, {
        start: () => setMood("praat"),
        level: setLevel,
        end: () => {
          setLevel(0);
          setMood("rust");
          if (convo.current) startListening();
        },
      });
    },
    [startListening],
  );

  const push = useCallback(
    (reply: BakenReply) => {
      setTurns((t) => [...t, { id: idRef.current++, role: "baken", text: reply.say, reply }]);
      setMood("rust");
      speak(reply.say);
    },
    [speak],
  );

  // Begroeting: Baken groet, vat vandaag samen en luistert daarna meteen (gespreksmodus staat aan).
  useEffect(() => {
    let alive = true;
    if (canListen) {
      convo.current = true;
      setConvoOn(true);
    }
    greet()
      .then((r) => alive && push(r))
      .catch(() => alive && setMood("rust"));
    return () => {
      alive = false;
      voice.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Eerste antwoord: Baken in beeld houden. Daarna meescrollen met het gesprek.
    if (turns.length > 1)
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const send = async (q: string) => {
    const text = q.trim();
    if (!text) return;
    setHint(null);
    setInput("");
    voice.stop();
    const history = turns.map((t) => ({
      role: t.role === "user" ? ("user" as const) : ("assistant" as const),
      content: t.text,
    }));
    setTurns((t) => [...t, { id: idRef.current++, role: "user", text }]);
    setMood("denkt");
    try {
      push(await ask(text, history));
    } catch {
      push({
        say: "Er liep iets mis bij het ophalen. Probeer het zo nog eens.",
        scenes: [],
        source: "lokaal",
      });
    }
  };
  sendRef.current = (q) => void send(q);

  /**
   * Tik op het baken of de microfoon: praat Baken, dan onderbreek je hem en luistert hij;
   * luistert hij, dan stopt het gesprek; anders start het gesprek.
   */
  const tapTalk = () => {
    voice.unlock();
    setHint(null);
    if (listening) {
      stopConvo();
      voice.stop();
      setListening(false);
      setMood("rust");
      return;
    }
    convo.current = true;
    setConvoOn(true);
    startListening();
  };
  const toggleMic = tapTalk;
  const toggleConvo = tapTalk;

  const last = [...turns].reverse().find((t) => t.role === "baken");
  const label = { rust: "Baken", luistert: "Ik luister…", denkt: "Even kijken…", praat: "Baken" }[
    mood
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden"
      role="dialog"
      aria-label="Baken"
    >
      {/* levende achtergrond */}
      <div className="absolute inset-0 bg-[#050d19]" />
      <div
        className="absolute -inset-[30%] opacity-80"
        style={{
          background:
            "radial-gradient(30% 30% at 30% 30%, rgb(20 184 166 / 30%), transparent 70%), radial-gradient(28% 28% at 70% 35%, rgb(14 165 233 / 28%), transparent 70%), radial-gradient(30% 30% at 50% 80%, rgb(144 133 233 / 18%), transparent 70%)",
          animation: "wt-sweep 60s linear infinite",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgb(255 255 255 / 6%) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />

      {/* kop */}
      <div className="relative z-10 flex items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+10px)]">
        <div className="flex-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
          Baken · Watchtower
        </div>
        <button
          type="button"
          onClick={() => {
            if (sound) voice.stop();
            setSound((s) => !s);
          }}
          className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/80"
          aria-label={sound ? "Stem uit" : "Stem aan"}
        >
          {sound ? <Volume2 className="size-[18px]" /> : <VolumeX className="size-[18px]" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white"
        >
          <X className="size-4" /> Sluiten
        </button>
      </div>

      {/* baken + gesprek */}
      <div
        ref={scroller}
        className="relative z-10 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
      >
        <div className="mx-auto max-w-2xl">
          <div className="flex flex-col items-center pt-2 pb-4">
            <button
              type="button"
              onClick={canListen ? toggleConvo : undefined}
              className="w-44 transition-all duration-500 md:w-56"
              aria-label="Praat met Baken"
            >
              <BakenCore mood={mood} level={level} />
            </button>
            <div className="mt-1 text-sm font-semibold tracking-wide text-white/70">{label}</div>
            {canListen && (
              <div className="mt-0.5 text-[12px] text-white/40">
                {hint ??
                  (mood === "praat"
                    ? "Tik om te onderbreken"
                    : convoOn
                      ? "Gesprek loopt · tik om te stoppen"
                      : "Tik op het baken om te praten")}
              </div>
            )}
          </div>

          <div className="space-y-5">
            {turns.map((t) =>
              t.role === "user" ? (
                <div key={t.id} className="rise flex justify-end">
                  <div className="max-w-[85%] rounded-[22px] rounded-br-md bg-white/[0.1] px-4 py-2.5 text-[15px] text-white">
                    {t.text}
                  </div>
                </div>
              ) : (
                <div key={t.id} className="rise space-y-3">
                  <p className="text-[19px] leading-snug font-semibold text-white md:text-[22px]">
                    {t.text.split(" ").map((w, i) => (
                      <span
                        key={i}
                        className="inline-block opacity-0"
                        style={{ animation: `wt-rise 0.35s ease ${i * 45}ms forwards` }}
                      >
                        {w}&nbsp;
                      </span>
                    ))}
                  </p>
                  {t.reply?.scenes.map((s, i) => (
                    <SceneView key={i} scene={s} onClose={onClose} onOpenProposal={setProposal} />
                  ))}
                  {t.reply?.source === "model" && (
                    <div className="text-[11px] text-white/35">antwoord via taalmodel</div>
                  )}
                </div>
              ),
            )}
            {mood === "denkt" && (
              <div className="flex gap-1.5 pl-1" aria-label="Baken denkt">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-2 rounded-full bg-[#a78bfa]"
                    style={{ animation: `wt-breathe 1s ease-in-out ${i * 0.15}s infinite` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* invoer */}
      <div className="relative z-10 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <div className="mx-auto max-w-2xl">
          {(!last || turns.length < 3) && (
            <div className="-mx-4 mb-2.5 flex gap-2 overflow-x-auto px-4 pb-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    stopConvo();
                    void send(s);
                  }}
                  className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-2 text-sm text-white/85 backdrop-blur-xl transition-colors hover:bg-white/[0.12]"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              stopConvo();
              void send(input);
            }}
            className="flex items-center gap-2 rounded-[26px] border border-white/12 bg-white/[0.07] p-1.5 backdrop-blur-2xl"
            style={{
              boxShadow:
                "0 20px 50px -20px rgb(0 0 0 / 80%), inset 0 1px 0 0 rgb(255 255 255 / 8%)",
            }}
          >
            {canListen && (
              <button
                type="button"
                onClick={toggleMic}
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-full transition-all",
                  listening ? "bg-[#fbbf24] text-[#1a1200]" : "bg-white/[0.08] text-white",
                )}
                aria-label={listening ? "Stop met luisteren" : "Spreek"}
              >
                {listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? "Ik luister…" : "Vraag het aan Baken"}
              className="min-w-0 flex-1 bg-transparent px-2 text-[16px] text-white placeholder:text-white/40 focus:outline-none"
              enterKeyHint="send"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-[#06202c] transition-opacity disabled:opacity-30"
              style={{ background: "linear-gradient(135deg,#2dd4bf,#22d3ee 55%,#38bdf8)" }}
              aria-label="Verstuur"
            >
              <ArrowUp className="size-5" strokeWidth={2.6} />
            </button>
          </form>
        </div>
      </div>

      <ProposalSheet id={proposal} onOpenChange={setProposal} />
    </div>
  );
}

// ---------- provider + knop ----------

export function BakenProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <Ctx.Provider
      value={{
        open: () => {
          voice.unlock(); // binnen de tik, anders blijft iOS stil
          setOpen(true);
        },
      }}
    >
      {children}
      {open && (
        <BakenExperience
          onClose={() => {
            voice.stop();
            setOpen(false);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

/** Zwevende Baken-knop, boven de tabbalk. */
export function BakenButton() {
  const { open } = useBaken();
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Praat met Baken"
      className="fixed right-4 z-40 flex items-center gap-2 rounded-full border border-white/10 bg-[#0b1a2e]/80 py-1.5 pr-4 pl-1.5 text-sm font-bold text-white backdrop-blur-xl transition-transform active:scale-95 md:right-8 md:bottom-8!"
      style={{
        bottom: "calc(env(safe-area-inset-bottom) + 92px)",
        boxShadow:
          "0 12px 34px -10px rgb(34 211 238 / 55%), inset 0 1px 0 0 rgb(255 255 255 / 10%)",
      }}
    >
      <span className="size-10">
        <BakenCore mood="rust" />
      </span>
      Baken
    </button>
  );
}
