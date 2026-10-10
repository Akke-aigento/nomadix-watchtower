import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/components/watchtower";
import {
  disablePush,
  enablePush,
  pushState,
  sendTestPush,
  type PushState,
} from "@/lib/push-client";

export const Route = createFileRoute("/_authenticated/meldingen")({
  head: () => ({ meta: [{ title: "Meldingen — Nomadix Watchtower" }] }),
  component: MeldingenPage,
});

const RULES: Array<{ sev: string; color: string; rows: Array<[string, string, string?]> }> = [
  {
    sev: "Actie",
    color: "var(--crit)",
    rows: [
      ["Push op dit toestel", "Altijd", "Ook ’s nachts — een site die plat ligt wacht niet"],
      ["Mail", "Direct"],
      ["Herinnering tot erkend", "30 min, na 2 u elke 4 u"],
    ],
  },
  {
    sev: "Aandacht",
    color: "var(--warn)",
    rows: [
      ["In de ochtendmail", "07:30"],
      ["Push", "Nooit", "Kan wachten tot morgen"],
    ],
  },
  {
    sev: "Opgelost",
    color: "var(--ok)",
    rows: [["Push + mail als een actie voorbij is", "Altijd"]],
  },
  {
    sev: "Vooraf weten",
    color: "var(--muted-foreground)",
    rows: [
      ["Ochtendmail", "07:30", "Ook als alles rustig is"],
      ["Certificaten", "30 dagen op voorhand"],
    ],
  },
];

function MeldingenPage() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pushState()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, []);

  const devices = useQuery({
    queryKey: ["push_subscriptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("push_subscriptions")
        .select("id, user_agent, created_at, last_success_at, failure_count")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setState(await pushState());
      queryClient.invalidateQueries({ queryKey: ["push_subscriptions"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Meldingen</h1>
          <p className="mt-1 text-sm text-muted-foreground">Wat je wanneer hoort, per ernst.</p>
        </header>

        <section className="panel space-y-4 p-5">
          <h2 className="text-tech text-xs text-muted-foreground">Dit toestel</h2>
          {state === "loading" && <p className="text-sm text-muted-foreground">Even kijken…</p>}
          {state === "needs-homescreen" && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Zet Watchtower eerst op je beginscherm.</p>
              <p className="text-muted-foreground">
                Op iPhone werken meldingen enkel vanuit de app op je beginscherm: tik in Safari op
                het deel-icoon, kies “Zet op beginscherm”, open Watchtower vanaf daar en kom terug
                naar deze pagina.
              </p>
            </div>
          )}
          {state === "unsupported" && (
            <p className="text-sm text-muted-foreground">
              Deze browser ondersteunt geen pushmeldingen.
            </p>
          )}
          {state === "denied" && (
            <p className="text-sm text-muted-foreground">
              Meldingen staan geblokkeerd voor Watchtower. Zet ze aan in de instellingen van je
              toestel en kom terug.
            </p>
          )}
          {state === "off" && (
            <Button
              size="lg"
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={() => run(enablePush, "Meldingen staan aan")}
            >
              Meldingen aanzetten
            </Button>
          )}
          {state === "on" && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await sendTestPush();
                    if (!r.delivered) throw new Error("Geen toestel bereikt");
                  }, "Testmelding verstuurd")
                }
              >
                Testmelding sturen
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => run(disablePush, "Meldingen uit op dit toestel")}
              >
                Uitzetten op dit toestel
              </Button>
            </div>
          )}
        </section>

        <section className="space-y-5">
          {RULES.map((block) => (
            <div key={block.sev}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: block.color }}
                />
                <span className="text-tech text-xs text-muted-foreground">{block.sev}</span>
              </div>
              <div className="panel divide-y divide-border">
                {block.rows.map(([label, value, sub]) => (
                  <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <div className="text-sm">{label}</div>
                      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
                    </div>
                    <span className="text-sm font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <h2 className="text-tech text-xs text-muted-foreground">Geregistreerde toestellen</h2>
          <div className="panel divide-y divide-border">
            {(devices.data ?? []).length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                Nog geen toestel — zet meldingen aan op je gsm.
              </p>
            ) : (
              (devices.data ?? []).map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                >
                  <span className="truncate">{deviceName(d.user_agent)}</span>
                  <span className="text-tech shrink-0 text-[11px] text-muted-foreground">
                    {d.failure_count > 0
                      ? `${d.failure_count}× mislukt`
                      : d.last_success_at
                        ? `laatst bereikt ${relativeTime(d.last_success_at)}`
                        : `toegevoegd ${relativeTime(d.created_at)}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function deviceName(ua: string | null): string {
  if (!ua) return "Onbekend toestel";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Browser";
}
