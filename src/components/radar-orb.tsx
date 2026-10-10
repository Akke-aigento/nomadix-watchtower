import { cn } from "@/lib/utils";

const LEVEL: Record<string, string> = {
  rustig: "#34d399",
  aandacht: "#fbbf24",
  actie: "#fb7185",
};

/**
 * Het levende Watchtower-oog: de zeshoek uit het logo, een lens die meekijkt,
 * een radar die rondzwaait en een kern in de kleur van de toestand.
 */
export function RadarOrb({
  level,
  className,
}: {
  level: "rustig" | "aandacht" | "actie";
  className?: string;
}) {
  const c = LEVEL[level];
  return (
    <div className={cn("relative aspect-square", className)} aria-hidden>
      {/* uitdijende ringen */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute inset-[14%] rounded-full border"
          style={{
            borderColor: `${c}55`,
            animation: `wt-ring ${level === "actie" ? 1.8 : 3.6}s ease-out ${i * (level === "actie" ? 0.6 : 1.2)}s infinite`,
          }}
        />
      ))}
      {/* gloed */}
      <span
        className="absolute inset-[18%] rounded-full blur-2xl"
        style={{ background: `${c}33` }}
      />
      {/* radarzwaai binnen de lens */}
      <span className="absolute inset-[24%] overflow-hidden rounded-full">
        <span
          className="absolute inset-0"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, transparent 280deg, ${c}10 300deg, ${c}66 358deg, transparent 360deg)`,
            animation: "wt-sweep 4.5s linear infinite",
          }}
        />
      </span>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        <defs>
          <linearGradient id="orb-g" x1="15" y1="10" x2="85" y2="90" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#14b8a6" />
            <stop offset=".5" stopColor="#06b6d4" />
            <stop offset="1" stopColor="#0ea5e9" />
          </linearGradient>
          <mask id="orb-m">
            <rect width="100" height="100" fill="#fff" />
            <circle cx="84.4" cy="30.5" r="9.5" fill="#000" />
          </mask>
        </defs>
        {/* zeshoek uit het logo */}
        <path
          d="M50 11 L84.4 30.5 L84.4 69.5 L50 89 L15.6 69.5 L15.6 30.5 Z"
          fill="none"
          stroke="url(#orb-g)"
          strokeWidth="3.4"
          strokeLinejoin="round"
          mask="url(#orb-m)"
        />
        <circle cx="84.4" cy="30.5" r="5.6" fill="#0ea5e9" />
        {/* lens */}
        <circle
          cx="50"
          cy="50"
          r="25"
          fill="none"
          stroke="url(#orb-g)"
          strokeOpacity=".35"
          strokeWidth="1"
        />
        <circle cx="50" cy="50" r="14.5" fill="none" stroke="url(#orb-g)" strokeWidth="3" />
      </svg>
      {/* kern */}
      <span className="absolute inset-0 flex items-center justify-center">
        <span
          className="size-[11%] rounded-full"
          style={{
            background: c,
            boxShadow: `0 0 18px 4px ${c}88`,
            animation: "wt-breathe 2.8s ease-in-out infinite",
          }}
        />
      </span>
    </div>
  );
}
