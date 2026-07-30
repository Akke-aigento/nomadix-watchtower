import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { CHECK_LABEL, StatusDot, formatDateTime } from "@/components/watchtower";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts — Nomadix Watchtower" },
      { name: "description", content: "Chronologische alert-historiek van alle properties." },
      { property: "og:title", content: "Alerts — Nomadix Watchtower" },
      {
        property: "og:description",
        content: "Chronologische alert-historiek van alle properties.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AlertsPage,
});

function AlertsPage() {
  const alertsQuery = useQuery({
    queryKey: ["alert_log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_log")
        .select("*, watch_targets(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const rows = alertsQuery.data ?? [];

  return (
    <AppShell>
      <div className="space-y-6">
        <h1 className="text-lg font-semibold tracking-tight">Alerts</h1>

        {alertsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Laden…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nog geen alerts.</p>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-tech border-b border-border text-[10px] text-muted-foreground">
                  <th className="px-4 py-2 text-left">Tijd</th>
                  <th className="px-4 py-2 text-left">Target</th>
                  <th className="px-4 py-2 text-left">Check</th>
                  <th className="px-4 py-2 text-left">Overgang</th>
                  <th className="px-4 py-2 text-left">Mail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const to = a.transition.split("->").at(-1) ?? "unknown";
                  return (
                    <tr key={a.id} className="border-b border-border/60 last:border-0">
                      <td className="text-tech px-4 py-2 text-[11px] text-muted-foreground">
                        {formatDateTime(a.created_at)}
                      </td>
                      <td className="px-4 py-2">
                        {a.target_id ? (
                          <Link
                            to="/target/$id"
                            params={{ id: a.target_id }}
                            className="text-primary hover:underline"
                          >
                            {a.watch_targets?.name ?? "—"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2">{CHECK_LABEL[a.check_key] ?? a.check_key}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-2 font-mono text-xs">
                          <StatusDot status={to} />
                          {a.transition}
                        </span>
                      </td>
                      <td className="text-tech px-4 py-2 text-[10px] text-muted-foreground">
                        {a.mailed ? "verzonden" : "niet verzonden"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
