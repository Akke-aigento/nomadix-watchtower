import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Beloftes = checks in mensentaal, met een 30-dagenbalk per dag. */
const PROMISE: Record<string, string> = {
  http: "Bereikbaar",
  ssl: "Certificaat geldig",
  dns: "Mail komt niet in spam (SPF/DMARC)",
  health: "Werkt van binnen (health)",
  form_smoke: "Formulier bereikbaar",
  domain: "Domeinnaam verlengd",
};

type Day = { day: string; check_key: string; ok: number; warn: number; fail: number; unknown: number };

function dayColor(d: Day | undefined): string {
  if (!d) return "var(--secondary)";
  if (d.fail > 0) return "var(--crit)";
  if (d.warn > 0) return "var(--warn)";
  if (d.ok > 0) return "var(--ok)";
  return "var(--muted)";
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" });
  for (let i = n - 1; i >= 0; i--) out.push(fmt.format(new Date(Date.now() - i * 86400000)));
  return out;
}

export function Promises({
  targetId,
  checks,
  latest,
}: {
  targetId: string;
  checks: string[];
  latest: Map<string, { status: string; summary: string }>;
}) {
  const q = useQuery({
    queryKey: ["daily_check_status", targetId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wt_daily_check_status", { p_target: targetId, p_days: 30 });
      if (error) throw error;
      return (data ?? []) as Day[];
    },
  });
  const days = lastNDays(30);
  const byKey = new Map<string, Day>();
  for (const d of q.data ?? []) byKey.set(`${d.check_key}|${d.day}`, d);

  return (
    <section className="space-y-2.5">
      <h2 className="text-tech text-xs text-muted-foreground">Beloftes · laatste 30 dagen</h2>
      <div className="panel divide-y divide-border">
        {checks.map((key) => {
          const now = latest.get(key);
          const label =
            now?.status === "fail"
              ? ["Actie", "var(--crit)"]
              : now?.status === "warn"
                ? ["Aandacht", "var(--warn)"]
                : now?.status === "ok"
                  ? ["Rustig", "var(--ok)"]
                  : ["Niet gemeten", "var(--muted-foreground)"];
          return (
            <div key={key} className="space-y-2 px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-medium">{PROMISE[key] ?? key}</span>
                <span className="shrink-0 text-xs font-semibold" style={{ color: label[1] }}>
                  {label[0]}
                </span>
              </div>
              {now?.summary && <p className="text-sm text-muted-foreground">{now.summary}</p>}
              <div className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(30, minmax(0, 1fr))" }}>
                {days.map((d) => {
                  const row = byKey.get(`${key}|${d}`);
                  return (
                    <span
                      key={d}
                      title={`${d}: ${row ? `${row.ok} ok, ${row.warn} warn, ${row.fail} fail, ${row.unknown} niet gemeten` : "geen meting"}`}
                      className="block h-4 rounded-[2px]"
                      style={{ background: dayColor(row), opacity: row ? 0.85 : 0.35 }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
