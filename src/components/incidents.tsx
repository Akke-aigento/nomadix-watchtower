import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, relativeTime } from "@/components/watchtower";
import { cn } from "@/lib/utils";

export const SEVERITY_LABEL: Record<string, string> = {
  actie: "Actie",
  aandacht: "Aandacht",
  monitor: "Zelfcontrole",
};

const SEVERITY_RANK: Record<string, number> = { actie: 0, aandacht: 1, monitor: 2 };

function severityClass(sev: string) {
  return sev === "actie"
    ? "border-[var(--crit)]/40 bg-[var(--crit)]/10 text-[var(--crit)]"
    : sev === "aandacht"
      ? "border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--warn)]"
      : "border-border bg-secondary text-muted-foreground";
}

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={cn("text-tech rounded border px-1.5 py-0.5 text-[10px]", severityClass(severity))}
    >
      {SEVERITY_LABEL[severity] ?? severity}
    </span>
  );
}

type IncidentRow = {
  id: string;
  target_id: string;
  check_key: string;
  severity: string;
  status: string;
  title: string;
  summary: string | null;
  opened_at: string;
  resolved_at: string | null;
  acknowledged_until: string | null;
  acknowledged_note: string | null;
  watch_targets?: { name: string } | null;
};

export function isAcknowledged(i: Pick<IncidentRow, "acknowledged_until">) {
  return !!i.acknowledged_until && Date.parse(i.acknowledged_until) > Date.now();
}

export function useIncidents(opts: { targetId?: string; includeResolved?: boolean } = {}) {
  return useQuery({
    queryKey: ["incidents", opts.targetId ?? "all", !!opts.includeResolved],
    queryFn: async () => {
      let q = supabase
        .from("incidents")
        .select("*, watch_targets(name)")
        .order("opened_at", { ascending: false })
        .limit(100);
      if (opts.targetId) q = q.eq("target_id", opts.targetId);
      if (!opts.includeResolved) q = q.eq("status", "open");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as IncidentRow[];
    },
    refetchInterval: 60_000,
  });
}

export function IncidentList({
  incidents,
  showTarget = true,
  emptyText = "Geen open incidenten.",
}: {
  incidents: IncidentRow[];
  showTarget?: boolean;
  emptyText?: string;
}) {
  const [ackFor, setAckFor] = useState<IncidentRow | null>(null);
  const queryClient = useQueryClient();

  const unack = useMutation({
    mutationFn: async (i: IncidentRow) => {
      const { error } = await supabase
        .from("incidents")
        .update({ acknowledged_until: null, acknowledged_note: null })
        .eq("id", i.id);
      if (error) throw error;
      await supabase
        .from("incident_events")
        .insert({ incident_id: i.id, kind: "unacknowledged", message: "erkenning opgeheven" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      toast.success("Erkenning opgeheven");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sorted = [...incidents].sort((a, b) => {
    const ackA = isAcknowledged(a) || a.status !== "open" ? 1 : 0;
    const ackB = isAcknowledged(b) || b.status !== "open" ? 1 : 0;
    if (ackA !== ackB) return ackA - ackB;
    const r = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    return r !== 0 ? r : Date.parse(b.opened_at) - Date.parse(a.opened_at);
  });

  if (sorted.length === 0) {
    return <p className="panel p-4 text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <>
      <ul className="space-y-2">
        {sorted.map((i) => {
          const acked = isAcknowledged(i);
          const resolved = i.status !== "open";
          return (
            <li
              key={i.id}
              className={cn(
                "panel flex flex-wrap items-start gap-3 p-4",
                (acked || resolved) && "opacity-70",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={i.severity} />
                  {showTarget && (
                    <Link
                      to="/target/$id"
                      params={{ id: i.target_id }}
                      className="text-sm font-medium hover:text-primary"
                    >
                      {i.watch_targets?.name ?? "target"}
                    </Link>
                  )}
                  <span className="text-tech text-[10px] text-muted-foreground">
                    {resolved
                      ? `opgelost ${relativeTime(i.resolved_at)}`
                      : `open sinds ${formatDateTime(i.opened_at)}`}
                  </span>
                </div>
                <p className="mt-1 font-medium">{i.title}</p>
                {i.summary && <p className="mt-0.5 text-sm text-muted-foreground">{i.summary}</p>}
                {acked && (
                  <p className="text-tech mt-1 text-[11px] text-muted-foreground">
                    Erkend tot {formatDateTime(i.acknowledged_until)}
                    {i.acknowledged_note ? ` — ${i.acknowledged_note}` : ""}
                  </p>
                )}
              </div>
              {!resolved &&
                (acked ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={unack.isPending}
                    onClick={() => unack.mutate(i)}
                  >
                    Erkenning opheffen
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setAckFor(i)}>
                    Erkennen
                  </Button>
                ))}
            </li>
          );
        })}
      </ul>
      <AcknowledgeDialog incident={ackFor} onClose={() => setAckFor(null)} />
    </>
  );
}

const ACK_PRESETS = [
  { label: "1 dag", days: 1 },
  { label: "1 week", days: 7 },
  { label: "1 maand", days: 30 },
];

function AcknowledgeDialog({
  incident,
  onClose,
}: {
  incident: IncidentRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(7);
  const [note, setNote] = useState("");

  const ack = useMutation({
    mutationFn: async () => {
      if (!incident) return;
      const until = new Date(Date.now() + days * 86400000).toISOString();
      const { error } = await supabase
        .from("incidents")
        .update({ acknowledged_until: until, acknowledged_note: note.trim() || null })
        .eq("id", incident.id);
      if (error) throw error;
      await supabase.from("incident_events").insert({
        incident_id: incident.id,
        kind: "acknowledged",
        message: `erkend voor ${days} dag(en)${note.trim() ? `: ${note.trim()}` : ""}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      queryClient.invalidateQueries({ queryKey: ["watch_targets"] });
      toast.success("Erkend — geen meldingen tot de einddatum");
      setNote("");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!incident} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Erkennen</DialogTitle>
          <DialogDescription>
            {incident?.title}. Je krijgt hier geen meldingen meer over tot de gekozen datum. Wordt
            het intussen opgelost, dan sluit het incident vanzelf.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {ACK_PRESETS.map((p) => (
              <Button
                key={p.days}
                type="button"
                size="sm"
                variant={days === p.days ? "default" : "outline"}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ack-note">Notitie (optioneel)</Label>
            <Input
              id="ack-note"
              value={note}
              placeholder="bv. SPF zit bij one.com, ticket loopt"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuleren
          </Button>
          <Button disabled={ack.isPending} onClick={() => ack.mutate()}>
            Erkennen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
