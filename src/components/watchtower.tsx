import { cn } from "@/lib/utils";

export type Status = "ok" | "warn" | "fail" | "unknown";

export const STATUS_LABEL: Record<Status, string> = {
  ok: "OK",
  warn: "Waarschuwing",
  fail: "Storing",
  unknown: "Niet gemeten",
};

export const KIND_LABEL: Record<string, string> = {
  platform: "Platform",
  storefront: "Storefront",
  client_site: "Klantsite",
  venture: "Venture",
};

export const CHECK_LABEL: Record<string, string> = {
  http: "HTTP",
  ssl: "SSL",
  dns: "DNS",
  form_smoke: "Formulier",
  health: "Health",
  domain: "Domein",
  store: "Winkel",
  odoo: "Odoo",
};

export const CATEGORY_LABEL: Record<string, string> = {
  bug: "Bug",
  security: "Security",
  improvement: "Verbetering",
};

export const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  proposed: "Wacht op go",
  approved: "Go gegeven",
  in_progress: "Bezig",
  failed: "Mislukt",
  rejected: "Afgewezen",
  done: "Uitgevoerd",
};

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const s = (["ok", "warn", "fail"].includes(status) ? status : "unknown") as Status;
  return (
    <span
      aria-label={STATUS_LABEL[s]}
      title={STATUS_LABEL[s]}
      className={cn("status-dot", `dot-${s}`, className)}
    />
  );
}

export function StatusText({ status }: { status: string }) {
  const s = (["ok", "warn", "fail"].includes(status) ? status : "unknown") as Status;
  const color =
    s === "ok"
      ? "text-[var(--ok)]"
      : s === "warn"
        ? "text-[var(--warn)]"
        : s === "fail"
          ? "text-[var(--crit)]"
          : "text-muted-foreground";
  return <span className={cn("text-tech text-xs", color)}>{STATUS_LABEL[s]}</span>;
}

export function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="text-tech rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {KIND_LABEL[kind] ?? kind}
    </span>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  const cls =
    category === "bug"
      ? "border-[var(--crit)]/40 bg-[var(--crit)]/12 text-[var(--crit)]"
      : category === "security"
        ? "border-[var(--warn)]/40 bg-[var(--warn)]/12 text-[var(--warn)]"
        : "border-[var(--chart-5)]/40 bg-[var(--chart-5)]/12 text-[var(--chart-5)]";
  return (
    <span className={cn("text-tech rounded border px-1.5 py-0.5 text-[10px]", cls)}>
      {CATEGORY_LABEL[category] ?? category}
    </span>
  );
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "nooit";
  const diff = Date.now() - Date.parse(iso);
  const min = Math.round(diff / 60000);
  if (min < 1) return "zonet";
  if (min < 60) return `${min}m geleden`;
  const uur = Math.round(min / 60);
  if (uur < 24) return `${uur}u geleden`;
  const dagen = Math.round(uur / 24);
  if (dagen < 30) return `${dagen}d geleden`;
  return `${Math.round(dagen / 30)}mnd geleden`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("nl-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
