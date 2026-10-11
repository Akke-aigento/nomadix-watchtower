import { createFileRoute } from "@tanstack/react-router";

/**
 * Zelftest: loopt elke Watchtower-functie na en bewaart het resultaat in selftest_runs.
 * POST /api/public/selftest (x-cron-secret). Elke 3 uur via pg_cron; faalt er iets dat de vorige
 * keer wel werkte, dan krijgt Akke één melding. Neveneffectvrij: geen mails, geen pushes
 * (behalve die ene melding), geen schrijfacties buiten selftest_runs.
 */
type Result = { name: string; ok: boolean; ms: number; detail?: string };

export const Route = createFileRoute("/api/public/selftest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = request.headers.get("x-cron-secret");
        const { isValidCronSecret } = await import("@/lib/cron-secret.server");
        if (!secret || !(await isValidCronSecret(secret)))
          return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { SITE_URL } = await import("@/lib/site");
        const results: Result[] = [];
        const test = async (name: string, fn: () => Promise<string | void>) => {
          const t = Date.now();
          try {
            const detail = await fn();
            results.push({ name, ok: true, ms: Date.now() - t, detail: detail || undefined });
          } catch (e) {
            results.push({
              name,
              ok: false,
              ms: Date.now() - t,
              detail: (e instanceof Error ? e.message : String(e)).slice(0, 300),
            });
          }
        };
        const must = (cond: unknown, msg?: string) => {
          if (!cond) throw new Error(msg ?? "mislukt");
        };
        const sb = supabaseAdmin as unknown as {
          from: (t: string) => {
            select: (
              c: string,
              o?: object,
            ) => Promise<{ error: { message: string } | null; count?: number | null }>;
          };
        };

        // 1. Database: elke tabel/view die de app of Baken leest
        for (const t of [
          "watch_targets",
          "scan_results",
          "incidents",
          "incident_events",
          "proposals",
          "findings",
          "integrations",
          "integration_usages",
          "agenda",
          "agenda_items",
          "radar_coverage",
          "credit_latest",
          "site_analytics_daily",
          "site_analytics_lists",
          "baken_memory",
          "push_subscriptions",
          "web_access",
          "daily_summaries",
          "brief_log",
        ])
          await test(`db:${t}`, async () => {
            const { error, count } = await sb.from(t).select("*", { count: "exact", head: true });
            if (error) throw new Error(error.message);
            return `${count ?? "?"} rijen`;
          });

        // 2. Metingen lopen en zijn vers
        await test("metingen vers (< 25 min)", async () => {
          const { data } = await supabaseAdmin
            .from("scan_results")
            .select("measured_at")
            .order("measured_at", { ascending: false })
            .limit(1);
          const age = data?.[0] ? (Date.now() - Date.parse(data[0].measured_at)) / 60000 : Infinity;
          must(age < 25, `laatste meting ${Math.round(age)} min oud`);
          return `${Math.round(age)} min oud`;
        });
        await test("rpc wt_engine_health", async () => {
          const { data, error } = await supabaseAdmin.rpc("wt_engine_health");
          if (error) throw new Error(error.message);
          const h = data as { unbundled?: number; overdue_active?: number };
          must(!h.unbundled, `${h.unbundled} vondsten zonder pakket`);
          return `achterstallig actief: ${h.overdue_active ?? 0}`;
        });

        // 3. Ochtendbrief: bouwt (droog) en is vandaag verstuurd
        await test("ochtendbrief bouwt", async () => {
          const { morningBrief } = await import("@/lib/morning-brief.server");
          const r = await morningBrief({ dryRun: true });
          must((r.html?.length ?? 0) > 500, "lege brief");
          return `${r.sections.length} blokken`;
        });
        await test("ochtendbrief vandaag verstuurd", async () => {
          const hour = Number(
            new Intl.DateTimeFormat("en-GB", {
              timeZone: "Europe/Brussels",
              hour: "2-digit",
              hour12: false,
            }).format(new Date()),
          );
          if (hour < 8) return "nog niet aan de beurt";
          const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
          const { data, error } = await (
            supabaseAdmin as unknown as {
              from: (t: string) => {
                select: (c: string) => {
                  eq: (
                    c: string,
                    v: string,
                  ) => Promise<{
                    data: Array<{ sent: boolean; error: string | null }> | null;
                    error: { message: string } | null;
                  }>;
                };
              };
            }
          )
            .from("brief_log")
            .select("sent, error")
            .eq("day", today);
          if (error) throw new Error(error.message);
          // brief_log bestaat sinds 11-10-2026 13u; voor die dag is er geen logboek om te controleren.
          if (!(data ?? []).length && today <= "2026-10-11") return "logboek start vandaag";
          must(
            (data ?? []).some((r) => r.sent),
            `geen verstuurde brief vandaag${data?.[0]?.error ? ` (${data[0].error})` : ""}`,
          );
        });

        // 4. Eigen routes van buitenaf (zoals de gsm en ElevenLabs ze zien)
        await test("site bereikbaar", async () => {
          const r = await fetch(`${SITE_URL}/login`);
          must(r.ok, `HTTP ${r.status}`);
        });
        await test("agenda-feed (ICS)", async () => {
          const { data: token } = await supabaseAdmin.rpc("get_agenda_token");
          const r = await fetch(`${SITE_URL}/api/public/agenda.ics?token=${token}`);
          const body = await r.text();
          must(r.ok && body.startsWith("BEGIN:VCALENDAR"), `HTTP ${r.status}`);
          return `${(body.match(/BEGIN:VEVENT/g) ?? []).length} items`;
        });
        await test("Baken: stem en model", async () => {
          const r = await fetch(`${SITE_URL}/api/baken`);
          const j = (await r.json()) as { voice?: string; agent?: string };
          must(j.voice && j.agent, "ElevenLabs-sleutel ontbreekt");
        });
        await test("Baken: agents klaar (NL, NL-B, EN)", async () => {
          const r = await fetch(`${SITE_URL}/api/baken-agent`, {
            method: "POST",
            headers: { "x-cron-secret": secret },
          });
          const j = (await r.json()) as {
            varianten?: Array<{ variant: string; llm?: string; error?: string }>;
          };
          const bad = (j.varianten ?? []).filter((v) => v.error);
          must(
            r.ok && (j.varianten ?? []).length === 3 && !bad.length,
            bad.map((b) => `${b.variant}: ${b.error}`).join("; ") || `HTTP ${r.status}`,
          );
          return (j.varianten ?? []).map((v) => `${v.variant}=${v.llm}`).join(", ");
        });
        await test("Baken: dossier", async () => {
          const { buildDossier } = await import("@/lib/baken-dossier.server");
          const d = await buildDossier();
          must(d.includes("SITES") && d.includes("ERKEND"), "dossier onvolledig");
          return `${d.length} tekens`;
        });
        const { data: toolToken } = await supabaseAdmin.rpc("get_baken_tool_token" as never);
        const tool = (t: string, body: object) =>
          fetch(`${SITE_URL}/api/baken-tool?t=${t}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-baken-token": String(toolToken) },
            body: JSON.stringify(body),
          }).then((r) => r.json() as Promise<{ ok?: boolean; fout?: string; data?: unknown }>);
        await test("Baken-tool: lees", async () => {
          const j = await tool("lees", { sql: "select count(*) n from watch_targets" });
          must(j.ok, j.fout);
        });
        await test("Baken-tool: lees weigert geheimen", async () => {
          const j = await tool("lees", { sql: "select * from private.config" });
          must(!j.ok, "private.config was leesbaar!");
        });
        await test("Baken-tool: weigert zonder token", async () => {
          const r = await fetch(`${SITE_URL}/api/baken-tool?t=lees`, {
            method: "POST",
            body: "{}",
          });
          must(r.status === 401, `HTTP ${r.status}`);
        });
        await test("Baken-tool: onthoud + vergeet", async () => {
          const mark = `zelftest ${Date.now()}`;
          const a = await tool("onthoud", { feit: mark });
          must(a.ok, a.fout);
          const b = await tool("vergeet", { feit: mark });
          must(b.ok, b.fout);
        });
        await test("Baken: kader-check", async () => {
          const { frameCheck } = await import("@/lib/frame-check.server");
          const r = await frameCheck(SITE_URL, SITE_URL);
          return r.frameable ? "eigen site in kader: ja" : `eigen site in kader: nee (${r.reason})`;
        });

        // 5. Meldingen kunnen vertrekken (zonder echt te sturen)
        await test("push: sleutel en toestellen", async () => {
          const { data: jwk } = await supabaseAdmin.rpc("get_vapid_private_jwk");
          must(typeof jwk === "string" && jwk.length > 20, "VAPID-sleutel ontbreekt");
          const { count } = await supabaseAdmin
            .from("push_subscriptions")
            .select("*", { count: "exact", head: true });
          must((count ?? 0) > 0, "geen enkel toestel ingeschreven voor meldingen");
          return `${count} toestel(len)`;
        });

        const failed = results.filter((r) => !r.ok);
        const ok = failed.length === 0;
        const { data: prev } = await (
          supabaseAdmin as unknown as {
            from: (t: string) => {
              select: (c: string) => {
                order: (
                  c: string,
                  o: object,
                ) => {
                  limit: (
                    n: number,
                  ) => Promise<{ data: Array<{ ok: boolean; results: Result[] }> | null }>;
                };
              };
            };
          }
        )
          .from("selftest_runs")
          .select("ok, results")
          .order("ran_at", { ascending: false })
          .limit(1);
        await (
          supabaseAdmin as unknown as {
            from: (t: string) => { insert: (r: object) => Promise<unknown> };
          }
        )
          .from("selftest_runs")
          .insert({ ok, passed: results.length - failed.length, failed: failed.length, results });

        // Enkel melden wat nieuw kapot is (geen herhaalde meldingen voor hetzelfde).
        const wasBroken = new Set(
          (prev?.[0]?.results ?? []).filter((r) => !r.ok).map((r) => r.name),
        );
        const newlyBroken = failed.filter((f) => !wasBroken.has(f.name));
        if (newlyBroken.length) {
          const { pushToAll } = await import("@/lib/notify.server");
          await pushToAll(
            {
              title: `Zelftest: ${newlyBroken.length} functie(s) kapot`,
              body: newlyBroken
                .map((f) => `${f.name}: ${f.detail ?? ""}`)
                .join(" · ")
                .slice(0, 380),
              url: "/dashboard",
              severity: "aandacht",
              tag: "selftest",
            },
            "normal",
          ).catch(() => []);
        }
        return Response.json({
          ok,
          passed: results.length - failed.length,
          failed: failed.length,
          results,
        });
      },
    },
  },
});
