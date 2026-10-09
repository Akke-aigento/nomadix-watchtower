import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ShieldCheck, Server } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Nomadix Watchtower — Internal Monitoring" },
      {
        name: "description",
        content:
          "Internal monitoring console for all Nomadix properties: uptime, checks and incidents in one dark dashboard.",
      },
      { property: "og:title", content: "Nomadix Watchtower — Internal Monitoring" },
      {
        property: "og:description",
        content:
          "Internal monitoring console for all Nomadix properties: uptime, checks and incidents in one dark dashboard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,var(--color-accent),transparent_60%)] opacity-50" />
      <div className="relative w-full max-w-xl text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-lg border border-border bg-card">
          <img src="/logo-mark.svg" alt="" aria-hidden="true" className="size-8" />
        </div>
        <p className="text-tech mt-6 text-xs text-muted-foreground">Nomadix internal</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
          Watchtower
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Monitoring console voor alle Nomadix-properties. Toegang enkel voor
          teamleden met een bestaand account.
        </p>
        <div className="mt-8 flex justify-center">
          <Button asChild size="lg">
            <Link to="/login">Inloggen</Link>
          </Button>
        </div>
        <div className="text-tech mt-10 flex justify-center gap-6 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Server className="size-3.5" /> Properties
          </span>
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="size-3.5" /> Checks
          </span>
          <span className="inline-flex items-center gap-2">
            <Activity className="size-3.5" /> Incidents
          </span>
        </div>
      </div>
    </main>
  );
}
