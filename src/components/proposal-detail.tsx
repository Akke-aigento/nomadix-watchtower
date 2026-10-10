import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { CategoryBadge, PROPOSAL_STATUS_LABEL, formatDateTime } from "@/components/watchtower";
import { FindingCard, type Finding } from "@/components/findings";
import { cn } from "@/lib/utils";

export type Proposal = Tables<"proposals">;

const STATUS_COLOR: Record<string, string> = {
  proposed: "var(--primary)",
  approved: "var(--ok)",
  in_progress: "var(--warn)",
  failed: "var(--warn)",
  done: "var(--ok)",
  rejected: "var(--muted-foreground)",
};

/** Eén regel tekst uit een (lange) beschrijving: eerste zin, ingekort. */
export function oneLiner(text: string | null | undefined, max = 140): string {
  if (!text) return "";
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

export function StatusPill({ status }: { status: string }) {
  const failedYourTurn = status === "failed";
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={{
        color: STATUS_COLOR[status],
        borderColor: `color-mix(in oklab, ${STATUS_COLOR[status] ?? "var(--border)"} 45%, transparent)`,
      }}
    >
      {failedYourTurn ? "Jouw beurt / gestopt" : (PROPOSAL_STATUS_LABEL[status] ?? status)}
    </span>
  );
}

/** Compacte, aanklikbare kaart: korte samenvatting, tik voor alles. */
export function ProposalRow({
  p,
  onOpen,
  className,
}: {
  p: Pick<Proposal, "id" | "title" | "description" | "status" | "bundle_order" | "category">;
  onOpen: (id: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(p.id)}
      className={cn(
        "panel group flex w-full items-start gap-3 p-4 text-left transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-primary",
        className,
      )}
    >
      {p.bundle_order != null && (
        <span className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
          {p.bundle_order}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 font-semibold leading-snug">{p.title}</span>
          <StatusPill status={p.status} />
        </span>
        <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">
          {oneLiner(p.description, 220)}
        </span>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
          Meer lezen{" "}
          <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </button>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}

/** Alles over één voorstel: waarom, wat er gebeurt bij Go, bronnen en de andere stappen van het pakket. */
export function ProposalSheet({
  id,
  onOpenChange,
}: {
  id: string | null;
  onOpenChange: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["proposal_detail", id],
    enabled: !!id,
    queryFn: async () => {
      const { data: p, error } = await supabase
        .from("proposals")
        .select("*, watch_targets(name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      let siblings: Proposal[] = [];
      let findings: Finding[] = [];
      if (p.bundle) {
        const [s, f] = await Promise.all([
          supabase.from("proposals").select("*").eq("bundle", p.bundle).order("bundle_order"),
          supabase.from("findings").select("*").eq("bundle", p.bundle).order("severity"),
        ]);
        siblings = s.data ?? [];
        findings = (f.data ?? []) as Finding[];
      }
      return { p, siblings, findings };
    },
  });

  const decide = useMutation({
    mutationFn: async ({ pid, status }: { pid: string; status: string }) => {
      const { error } = await supabase
        .from("proposals")
        .update({ status, decided_at: new Date().toISOString() })
        .eq("id", pid);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      queryClient.invalidateQueries({ queryKey: ["proposal_detail"] });
      queryClient.invalidateQueries({ queryKey: ["nav_badges"] });
      toast.success(
        v.status === "approved"
          ? "Go gegeven — Watchtower pakt dit op bij de volgende ronde (rond 8u, 13u of 19u)"
          : v.status === "rejected"
            ? "Afgewezen"
            : "Bijgewerkt",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const p = q.data?.p;
  const siblings = q.data?.siblings ?? [];
  const findings = q.data?.findings ?? [];

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onOpenChange(null)}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-border bg-background p-0 sm:max-w-xl"
      >
        {!p ? (
          <div className="p-6">
            <SheetHeader>
              <SheetTitle>Laden…</SheetTitle>
            </SheetHeader>
          </div>
        ) : (
          <div className="flex min-h-full flex-col">
            <div className="space-y-6 px-5 pt-[calc(env(safe-area-inset-top)+20px)] pb-6">
              <SheetHeader className="space-y-3 p-0 text-left">
                <div className="flex flex-wrap items-center gap-2 pr-8">
                  <StatusPill status={p.status} />
                  <CategoryBadge category={p.category} />
                  {p.bundle_order != null && (
                    <span className="text-xs text-muted-foreground">
                      stap {p.bundle_order} van {siblings.length}
                    </span>
                  )}
                </div>
                <SheetTitle className="text-2xl font-bold leading-tight">{p.title}</SheetTitle>
                {p.bundle_title && (
                  <SheetDescription className="text-sm">Pakket: {p.bundle_title}</SheetDescription>
                )}
              </SheetHeader>

              {p.watch_targets?.name && p.target_id && (
                <Link
                  to="/target/$id"
                  params={{ id: p.target_id }}
                  onClick={() => onOpenChange(null)}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary"
                >
                  {p.watch_targets.name} <ExternalLink className="size-3.5" />
                </Link>
              )}

              <Block label="Waarom">
                <p className="text-[15px] leading-relaxed">{p.description}</p>
              </Block>

              <Block label="Wat er gebeurt als je Go geeft">
                <p className="whitespace-pre-wrap rounded-xl bg-secondary/60 p-3.5 text-[15px] leading-relaxed">
                  {p.proposed_action}
                </p>
              </Block>

              {p.result && (
                <Block label={p.status === "failed" ? "Wat Watchtower meldt" : "Resultaat"}>
                  <p className="rounded-xl border border-border p-3.5 text-[15px] leading-relaxed">
                    {p.result}
                  </p>
                </Block>
              )}

              {findings.length > 0 && (
                <Block label={`Gevonden bij de partner (${findings.length})`}>
                  <div className="space-y-2">
                    {findings.map((f) => (
                      <FindingCard key={f.id} f={f} className="bg-card" />
                    ))}
                  </div>
                </Block>
              )}

              {siblings.length > 1 && (
                <Block label="Alle stappen van dit pakket">
                  <div className="divide-y divide-border rounded-xl border border-border">
                    {siblings.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onOpenChange(s.id)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-secondary/40",
                          s.id === p.id && "bg-secondary/60",
                        )}
                      >
                        <span className="tabular w-5 shrink-0 text-muted-foreground">
                          {s.bundle_order}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <StatusPill status={s.status} />
                      </button>
                    ))}
                  </div>
                </Block>
              )}

              <p className="text-xs text-muted-foreground">
                Aangemaakt {formatDateTime(p.created_at)}
                {p.decided_at ? ` · beslist ${formatDateTime(p.decided_at)}` : ""}
                {p.executed_at ? ` · uitgevoerd ${formatDateTime(p.executed_at)}` : ""}
              </p>
            </div>

            {(p.status === "proposed" || p.status === "failed" || p.status === "rejected") && (
              <div className="sticky bottom-0 mt-auto flex gap-2 border-t border-border bg-background/95 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur">
                <Button
                  className="flex-1"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ pid: p.id, status: "approved" })}
                >
                  {p.status === "proposed" ? "Go" : "Opnieuw Go"}
                </Button>
                {p.status === "proposed" && (
                  <Button
                    variant="outline"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ pid: p.id, status: "rejected" })}
                  >
                    Afwijzen
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
