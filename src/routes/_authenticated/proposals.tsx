import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ProposalRow, ProposalSheet } from "@/components/proposal-detail";
import { cn } from "@/lib/utils";

/** De geplande Watchtower-ronde draait om 07:54, 12:54 en 18:54 (Brussel). */
function nextRunText(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  const now = h * 60 + m;
  const next = [7 * 60 + 54, 12 * 60 + 54, 18 * 60 + 54].find((t) => t > now);
  return next ? `Volgende ronde rond ${Math.round(next / 60)}u` : "Volgende ronde morgen rond 8u";
}

type Search = { id?: string };

export const Route = createFileRoute("/_authenticated/proposals")({
  validateSearch: (s: Record<string, unknown>): Search =>
    typeof s.id === "string" ? { id: s.id } : {},
  head: () => ({
    meta: [
      { title: "Voorstellen — Nomadix Watchtower" },
      {
        name: "description",
        content: "Alle voorstellen voor fixes, verbeteringen en besparingen.",
      },
    ],
  }),
  component: ProposalsPage,
});

const FILTERS: Array<{ key: string; label: string; match: (s: string) => boolean }> = [
  {
    key: "open",
    label: "Open",
    match: (s) => ["proposed", "approved", "in_progress", "failed"].includes(s),
  },
  { key: "proposed", label: "Wacht op go", match: (s) => s === "proposed" },
  { key: "failed", label: "Jouw beurt", match: (s) => s === "failed" },
  { key: "done", label: "Uitgevoerd", match: (s) => s === "done" },
  { key: "all", label: "Alles", match: () => true },
];

function ProposalsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/proposals" });
  const [filter, setFilter] = useState("open");
  const queryClient = useQueryClient();
  const openId = search.id ?? null;
  const setOpen = (id: string | null) => navigate({ search: id ? { id } : {}, replace: true });

  const proposalsQuery = useQuery({
    queryKey: ["proposals", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select(
          "id, title, description, status, category, bundle, bundle_title, bundle_order, created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const findingCounts = useQuery({
    queryKey: ["findings", "bundle_counts"],
    queryFn: async () => {
      const { data } = await supabase.from("findings").select("bundle").not("bundle", "is", null);
      const m = new Map<string, number>();
      for (const r of data ?? []) m.set(r.bundle as string, (m.get(r.bundle as string) ?? 0) + 1);
      return m;
    },
  });

  const approveBundle = useMutation({
    mutationFn: async (bundle: string) => {
      const { error } = await supabase
        .from("proposals")
        .update({ status: "approved", decided_at: new Date().toISOString() })
        .eq("bundle", bundle)
        .eq("status", "proposed");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      queryClient.invalidateQueries({ queryKey: ["nav_badges"] });
      toast.success(`Go voor het hele pakket — ${nextRunText().toLowerCase()}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const all = proposalsQuery.data ?? [];
  const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
  const rows = all.filter((p) => f.match(p.status));

  // Pakketten bij elkaar, pakketten met iets dat op jou wacht eerst; losse voorstellen daarna.
  const bundleKeys = [...new Set(rows.filter((p) => p.bundle).map((p) => p.bundle as string))].sort(
    (a, b) => {
      const wa = rows.some((p) => p.bundle === a && p.status === "proposed") ? 0 : 1;
      const wb = rows.some((p) => p.bundle === b && p.status === "proposed") ? 0 : 1;
      return wa - wb;
    },
  );
  const loose = rows.filter((p) => !p.bundle);
  const counts = Object.fromEntries(
    FILTERS.map((x) => [x.key, all.filter((p) => x.match(p.status)).length]),
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Voorstellen"
          title={counts.proposed ? `${counts.proposed} wachten op jouw go` : "Niets wacht op jou"}
          subtitle={`Tik op een voorstel voor alle uitleg, bronnen en de andere stappen van het pakket. ${nextRunText()}.`}
        />

        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
          role="tablist"
          aria-label="Filter"
        >
          {FILTERS.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={filter === x.key}
              onClick={() => setFilter(x.key)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                filter === x.key
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {x.label} <span className="tabular text-muted-foreground">{counts[x.key]}</span>
            </button>
          ))}
        </div>

        {proposalsQuery.isLoading ? (
          <div className="panel h-40 animate-pulse" />
        ) : rows.length === 0 ? (
          <p className="panel p-5 text-sm text-muted-foreground">Niets in deze lijst.</p>
        ) : (
          <div className="space-y-8">
            {bundleKeys.map((b) => {
              const steps = rows
                .filter((p) => p.bundle === b)
                .sort((x, y) => (x.bundle_order ?? 99) - (y.bundle_order ?? 99));
              const title = all.find((x) => x.bundle === b && x.bundle_title)?.bundle_title ?? b;
              const total = all.filter((x) => x.bundle === b).length;
              const waiting = steps.filter((p) => p.status === "proposed").length;
              const nf = findingCounts.data?.get(b) ?? 0;
              return (
                <section key={b} className="space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[17px] font-bold leading-snug">{title}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {total} {total === 1 ? "stap" : "stappen"}
                        {nf ? ` · ${nf} ${nf === 1 ? "vondst" : "vondsten"} bij de partner` : ""}
                        {waiting ? ` · ${waiting} wacht op go` : ""}
                      </p>
                    </div>
                    {waiting > 1 && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={approveBundle.isPending}
                        onClick={() => approveBundle.mutate(b)}
                      >
                        Go voor heel het pakket
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {steps.map((p) => (
                      <ProposalRow key={p.id} p={p} onOpen={setOpen} />
                    ))}
                  </div>
                </section>
              );
            })}

            {loose.length > 0 && (
              <section className="space-y-3">
                {bundleKeys.length > 0 && (
                  <h2 className="text-[17px] font-bold">Losse voorstellen</h2>
                )}
                <div className="space-y-2">
                  {loose.map((p) => (
                    <ProposalRow key={p.id} p={{ ...p, bundle_order: null }} onOpen={setOpen} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      <ProposalSheet id={openId} onOpenChange={setOpen} />
    </AppShell>
  );
}
