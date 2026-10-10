import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Globe, X } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/components/watchtower";

export const Route = createFileRoute("/_authenticated/toegang")({
  head: () => ({ meta: [{ title: "Toegang tot websites — Nomadix Watchtower" }] }),
  component: ToegangPage,
});

function ToegangPage() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["web_access"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("web_access")
        .select("*")
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const decide = useMutation({
    mutationFn: async ({
      domain,
      status,
    }: {
      domain: string;
      status: "toegestaan" | "geweigerd";
    }) => {
      const { error } = await supabase
        .from("web_access")
        .update({ status, decided_at: new Date().toISOString(), synced_at: null })
        .eq("domain", domain);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["web_access"] });
      queryClient.invalidateQueries({ queryKey: ["nav_badges"] });
      toast.success(
        v.status === "toegestaan"
          ? `${v.domain} toegestaan — actief vanaf de volgende ronde`
          : `${v.domain} geweigerd`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = list.data ?? [];
  const asked = rows.filter((r) => r.status === "gevraagd");
  const done = rows.filter((r) => r.status !== "gevraagd");

  const row = (r: (typeof rows)[number], actions: boolean) => (
    <div key={r.domain} className="flex items-center gap-3 px-4 py-3">
      <Globe className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[13px]">{r.domain}</div>
        <div className="truncate text-xs text-muted-foreground">
          {r.integration_key ? `${r.integration_key} · ` : ""}
          {r.reason}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 gap-1.5">
          <Button
            size="sm"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ domain: r.domain, status: "toegestaan" })}
          >
            <Check className="size-4" /> Toestaan
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Weigeren"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ domain: r.domain, status: "geweigerd" })}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="shrink-0 text-right text-xs">
          <div style={{ color: r.status === "toegestaan" ? "var(--ok)" : "var(--crit)" }}>
            {r.status}
          </div>
          <div className="text-muted-foreground">{r.synced_at ? "actief" : "volgende ronde"}</div>
        </div>
      )}
    </div>
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-8">
        <PageHeader
          eyebrow="Toegang"
          title="Websites die Watchtower mag lezen"
          subtitle="De radar leest changelogs, prijspagina's en statuspagina's van partners. Wat je hier toestaat, zet Watchtower bij de volgende ronde vast, zodat de geplande rondes niet meer om toestemming vragen. Andere Claude-gesprekken vragen nog zelf."
        />

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Gevraagd ({asked.length})
          </h2>
          {asked.length ? (
            <div className="panel divide-y divide-border">{asked.map((r) => row(r, true))}</div>
          ) : (
            <div className="panel px-4 py-5 text-sm text-muted-foreground">
              Niets te beslissen. Nieuwe aanvragen verschijnen hier met een melding.
            </div>
          )}
        </section>

        {done.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Beslist ({done.length}) · laatst{" "}
              {relativeTime(
                done
                  .map((d) => d.decided_at)
                  .filter(Boolean)
                  .sort()
                  .at(-1) as string | undefined,
              )}
            </h2>
            <div className="panel divide-y divide-border">{done.map((r) => row(r, false))}</div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
