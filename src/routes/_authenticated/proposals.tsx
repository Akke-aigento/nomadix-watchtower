import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  CategoryBadge,
  PROPOSAL_STATUS_LABEL,
  formatDateTime,
} from "@/components/watchtower";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** De geplande Claude-taak draait om 08:00, 13:00 en 19:00 (Brussel). */
function nextRunText(): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hour: "2-digit", hour12: false }).format(new Date()));
  const next = [8, 13, 19].find((h) => h > hour);
  return next ? `Claude pakt dit op om ${next}:00` : "Claude pakt dit morgen om 8:00 op";
}

export const Route = createFileRoute("/_authenticated/proposals")({
  head: () => ({
    meta: [
      { title: "Proposals — Nomadix Watchtower" },
      { name: "description", content: "Alle voorstellen voor fixes, verbeteringen en security." },
      { property: "og:title", content: "Proposals — Nomadix Watchtower" },
      {
        property: "og:description",
        content: "Alle voorstellen voor fixes, verbeteringen en security.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProposalsPage,
});

function ProposalsPage() {
  const [filter, setFilter] = useState("all");
  const queryClient = useQueryClient();

  const proposalsQuery = useQuery({
    queryKey: ["proposals", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("*, watch_targets(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("proposals")
        .update({ status, decided_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      toast.success("Voorstel bijgewerkt");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (proposalsQuery.data ?? []).filter((p) => filter === "all" || p.status === filter);

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center gap-4">
          <h1 className="text-lg font-semibold tracking-tight">Proposals</h1>
          <div className="ml-auto w-48">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle statussen</SelectItem>
                <SelectItem value="proposed">Wacht op go</SelectItem>
                <SelectItem value="approved">Goedgekeurd</SelectItem>
                <SelectItem value="rejected">Afgewezen</SelectItem>
                <SelectItem value="done">Uitgevoerd</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </header>

        {proposalsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Laden…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen voorstellen.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((p, i) => (
              <article
                key={p.id}
                className="fade-in-card panel p-4"
                style={{ animationDelay: `${i * 25}ms` }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <CategoryBadge category={p.category} />
                  <span className="text-tech rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {PROPOSAL_STATUS_LABEL[p.status] ?? p.status}
                  </span>
                  {p.watch_targets?.name && (
                    <Link
                      to="/target/$id"
                      params={{ id: p.target_id! }}
                      className="text-xs text-primary hover:underline"
                    >
                      {p.watch_targets.name}
                    </Link>
                  )}
                  <span className="text-tech ml-auto text-[10px] text-muted-foreground">
                    {formatDateTime(p.created_at)}
                  </span>
                </div>
                <h2 className="mt-2 font-medium">{p.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-secondary/60 p-3 font-mono text-xs leading-relaxed text-foreground/90">
                  {p.proposed_action}
                </pre>
                {p.result && (
                  <p className="mt-3 rounded-lg border border-border p-3 text-sm">
                    <span className="text-tech text-[10px] text-muted-foreground">Resultaat</span>
                    <br />
                    {p.result}
                  </p>
                )}
                {p.status === "proposed" && (
                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => decide.mutate({ id: p.id, status: "approved" })}
                    >
                      Go
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => decide.mutate({ id: p.id, status: "rejected" })}
                    >
                      Afwijzen
                    </Button>
                  </div>
                )}
                {p.status === "approved" && (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <span className="text-sm text-muted-foreground">{nextRunText()}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => decide.mutate({ id: p.id, status: "done" })}
                    >
                      Markeer als uitgevoerd
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
