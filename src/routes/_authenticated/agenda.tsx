import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/agenda")({
  head: () => ({ meta: [{ title: "Agenda — Nomadix Watchtower" }] }),
  component: AgendaPage,
});

const KIND_LABEL: Record<string, string> = {
  sunset: "Sunset",
  token: "Sleutel/token",
  certificate: "Certificaat",
  domain: "Domein",
  subscription: "Abonnement",
  migration: "Migratie",
  other: "Overig",
};

const SEV_COLOR: Record<string, string> = {
  actie: "var(--crit)",
  aandacht: "var(--warn)",
  info: "var(--muted-foreground)",
};

function daysUntil(date: string): number {
  const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" }));
  return Math.round((Date.parse(date) - today.getTime()) / 86400000);
}

function relDays(n: number): string {
  if (n < 0) return `${-n} d te laat`;
  if (n === 0) return "vandaag";
  if (n === 1) return "morgen";
  if (n < 60) return `over ${n} d`;
  if (n < 730) return `over ${Math.round(n / 30)} mnd`;
  return `over ${Math.round(n / 365)} jaar`;
}

function AgendaPage() {
  const queryClient = useQueryClient();

  const items = useQuery({
    queryKey: ["agenda"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agenda").select("*").eq("status", "open").order("due_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const token = useQuery({
    queryKey: ["agenda_token"],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_agenda_token");
      return typeof data === "string" ? data : null;
    },
  });

  const close = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "done" | "dismissed" }) => {
      const { error } = await supabase
        .from("agenda_items")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agenda"] });
      toast.success("Bijgewerkt");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const feedUrl = token.data
    ? `${typeof window !== "undefined" ? window.location.origin : "https://nomadix-watchtower.lovable.app"}/api/public/agenda.ics?token=${token.data}`
    : null;
  const webcal = feedUrl?.replace(/^https?:/, "webcal:");

  const rows = items.data ?? [];
  const groups: Array<{ label: string; filter: (n: number) => boolean }> = [
    { label: "Te laat", filter: (n) => n < 0 },
    { label: "Binnen 30 dagen", filter: (n) => n >= 0 && n <= 30 },
    { label: "Binnen 6 maanden", filter: (n) => n > 30 && n <= 183 },
    { label: "Later", filter: (n) => n > 183 },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Alles wat ooit verloopt: API-versies, sleutels, certificaten, domeinen. Watchtower vult dit zelf aan.
          </p>
        </header>

        {webcal && (
          <section className="panel space-y-3 p-4">
            <div className="text-sm font-medium">In je agenda op iPhone of Mac</div>
            <p className="text-sm text-muted-foreground">
              Eén tik: abonneer en elke deadline staat in je agenda, met een herinnering 30 en 7 dagen vooraf.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <a href={webcal}>Abonneren</a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(feedUrl!)
                    .then(() => toast.success("Link gekopieerd"))
                    .catch(() => toast.error("Kopiëren lukt niet"));
                }}
              >
                Kopieer link
              </Button>
            </div>
          </section>
        )}

        {items.isLoading ? (
          <p className="text-sm text-muted-foreground">Laden…</p>
        ) : (
          groups.map((g) => {
            const list = rows.filter((r) => g.filter(daysUntil(r.due_date)));
            if (!list.length) return null;
            return (
              <section key={g.label} className="space-y-2">
                <h2 className="text-tech text-xs text-muted-foreground">{g.label}</h2>
                <ul className="panel divide-y divide-border">
                  {list.map((r) => {
                    const n = daysUntil(r.due_date);
                    return (
                      <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                        <span
                          className="mt-1.5 inline-block size-2 shrink-0 rounded-full"
                          style={{ background: SEV_COLOR[r.severity] ?? SEV_COLOR.info }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="font-medium">{r.title}</span>
                            <span className={cn("text-tech shrink-0 text-xs", n < 0 ? "text-[var(--crit)]" : "text-muted-foreground")}>
                              {new Date(r.due_date).toLocaleDateString("nl-BE")} · {relDays(n)}
                            </span>
                          </div>
                          {r.description && <p className="mt-0.5 text-sm text-muted-foreground">{r.description}</p>}
                          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span>{KIND_LABEL[r.kind] ?? r.kind}</span>
                            {r.integration_key && (
                              <Link to="/koppelingen" className="hover:text-foreground">
                                koppeling: {r.integration_key}
                              </Link>
                            )}
                            {r.target_id && (
                              <Link to="/target/$id" params={{ id: r.target_id }} className="hover:text-foreground">
                                bekijk property
                              </Link>
                            )}
                            {r.source_url && (
                              <a href={r.source_url} target="_blank" rel="noreferrer" className="hover:text-foreground">
                                bron
                              </a>
                            )}
                          </div>
                        </div>
                        {r.origin === "agenda" && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => close.mutate({ id: r.id, status: "done" })}>
                              Gedaan
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
