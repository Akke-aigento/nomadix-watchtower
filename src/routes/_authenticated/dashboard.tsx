import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Overzicht — Nomadix Watchtower" },
      {
        name: "description",
        content: "Monitoring-overzicht van alle Nomadix-properties.",
      },
      { property: "og:title", content: "Overzicht — Nomadix Watchtower" },
      {
        property: "og:description",
        content: "Monitoring-overzicht van alle Nomadix-properties.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <AppShell>
      <h1 className="text-xl font-semibold tracking-tight">Overzicht</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        De shell staat klaar. Database, checks en widgets volgen met de spec.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {["Properties", "Checks", "Incidents", "Uptime"].map((label) => (
          <div key={label} className="panel p-4">
            <p className="text-tech text-[11px] text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-muted-foreground">—</p>
          </div>
        ))}
      </div>

      <div className="panel mt-4 flex h-48 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Wacht op spec-input.</p>
      </div>
    </AppShell>
  );
}
