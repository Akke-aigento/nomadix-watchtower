import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { formatDateTime, relativeTime } from "@/components/watchtower";
import { cn } from "@/lib/utils";
import { engineLine, type EngineHealth } from "@/lib/engine";

export { engineLine, type EngineHealth };

export type Finding = Tables<"findings">;

export const FINDING_KIND: Record<string, string> = {
  deprecation: "Uitfasering",
  breaking_change: "Brekende wijziging",
  pricing: "Prijs",
  plan: "Abonnement",
  security: "Security",
  policy: "Beleid",
  outage_pattern: "Storingspatroon",
  new_integration: "Nieuwe koppeling",
  opportunity: "Kans",
};

export const IMPACT: Record<string, [string, string]> = {
  raakt_ons: ["raakt ons", "var(--crit)"],
  onzeker: ["impact onzeker", "var(--warn)"],
  raakt_ons_niet: ["raakt ons niet", "var(--muted-foreground)"],
};

export const FINDING_STATUS: Record<string, string> = {
  nieuw: "nieuw",
  pakket: "pakket klaar",
  opgelost: "opgelost",
  verworpen: "verworpen",
};

/** Waar in de keten een partner voorkomt (integration_usages.kind). */
export const TOUCH: Array<[string, string]> = [
  ["code", "code"],
  ["beheer", "beheerschermen"],
  ["marketing", "marketing"],
  ["helpartikel", "helpartikels"],
];

export function useEngineHealth() {
  return useQuery({
    queryKey: ["engine_health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wt_engine_health");
      if (error) throw error;
      return data as unknown as EngineHealth;
    },
    refetchInterval: 300_000,
  });
}

export function TouchpointChips({ touchpoints }: { touchpoints: unknown }) {
  const tp = (touchpoints ?? {}) as Record<string, number>;
  const present = TOUCH.filter(([k]) => tp[k]);
  if (!present.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {present.map(([k, label]) => (
        <span
          key={k}
          className="text-tech rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {label} {tp[k]}
        </span>
      ))}
    </span>
  );
}

export function FindingCard({
  f,
  partner,
  className,
}: {
  f: Finding;
  partner?: string;
  className?: string;
}) {
  const [impactLabel, impactColor] = IMPACT[f.impact] ?? [f.impact, "var(--muted-foreground)"];
  return (
    <article className={cn("rounded-xl border border-border p-4", className)}>
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <span className="text-tech rounded border border-border px-1.5 py-0.5 text-muted-foreground">
          {FINDING_KIND[f.kind] ?? f.kind}
        </span>
        <span
          className="text-tech rounded border px-1.5 py-0.5"
          style={{ color: impactColor, borderColor: impactColor }}
        >
          {impactLabel}
        </span>
        {partner && <span className="text-tech text-muted-foreground">{partner}</span>}
        <span className="text-tech ml-auto text-muted-foreground">
          {FINDING_STATUS[f.status] ?? f.status} · {relativeTime(f.detected_at)}
        </span>
      </div>
      <h3 className="mt-2 font-medium">{f.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{f.summary}</p>
      {f.analysis && <p className="mt-2 text-sm">{f.analysis}</p>}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {f.effective_date && (
          <span>ingangsdatum {formatDateTime(f.effective_date).slice(0, 8)}</span>
        )}
        {f.affected_tenants != null && <span>{f.affected_tenants} tenant(s) geraakt</span>}
        <a
          className="underline-offset-4 hover:underline"
          href={f.source_url}
          target="_blank"
          rel="noreferrer"
        >
          bron
        </a>
      </div>
    </article>
  );
}
