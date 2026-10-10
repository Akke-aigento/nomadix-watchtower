-- Watchtower v3 — credit-radar en toegang tot websites.
--
-- credit_snapshots : per Lovable-project een momentopname van wat credits kost
--                    (DB-exec-tijd per dag, crons, dure queries, realtime-tabellen, opslag).
--                    De geplande Claude-run vult dit via de Lovable-connector (read-only per project).
-- credit_latest    : laatste momentopname per project (view).
-- web_access       : domeinen die de radar wil lezen; Akke keurt goed in Watchtower,
--                    de volgende run zet goedgekeurde domeinen in .claude/settings.json.
-- Cron-hygiëne     : dagelijkse purge van cron.job_run_details ouder dan 7 dagen.
-- Idempotent. Terugdraaien: DROP VIEW credit_latest; DROP TABLE credit_snapshots, web_access;
-- SELECT cron.unschedule('watchtower-cron-hygiene');

CREATE TABLE IF NOT EXISTS public.credit_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lovable_project_id text NOT NULL,
  project_name text NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  exec_s_per_day numeric NULL,
  stats_since timestamptz NULL,
  db_size_mb numeric NULL,
  pg_net_backlog int NULL,
  crons jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  realtime_tables text[] NOT NULL DEFAULT '{}',
  drivers text[] NOT NULL DEFAULT '{}',
  savings jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'claude'
);
CREATE INDEX IF NOT EXISTS credit_snapshots_project_idx ON public.credit_snapshots (lovable_project_id, taken_at DESC);

ALTER TABLE public.credit_snapshots ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_snapshots TO authenticated;
GRANT ALL ON public.credit_snapshots TO service_role;
DROP POLICY IF EXISTS credit_snapshots_admin_all ON public.credit_snapshots;
CREATE POLICY credit_snapshots_admin_all ON public.credit_snapshots FOR ALL TO authenticated
  USING (public.is_watchtower_admin()) WITH CHECK (public.is_watchtower_admin());

CREATE OR REPLACE VIEW public.credit_latest WITH (security_invoker = true) AS
SELECT DISTINCT ON (lovable_project_id) *
FROM public.credit_snapshots
ORDER BY lovable_project_id, taken_at DESC;
GRANT SELECT ON public.credit_latest TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.web_access (
  domain text PRIMARY KEY,
  reason text NOT NULL,
  integration_key text NULL,
  status text NOT NULL DEFAULT 'gevraagd' CHECK (status IN ('gevraagd', 'toegestaan', 'geweigerd')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL,
  synced_at timestamptz NULL
);
ALTER TABLE public.web_access ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.web_access TO authenticated;
GRANT ALL ON public.web_access TO service_role;
DROP POLICY IF EXISTS web_access_admin_all ON public.web_access;
CREATE POLICY web_access_admin_all ON public.web_access FOR ALL TO authenticated
  USING (public.is_watchtower_admin()) WITH CHECK (public.is_watchtower_admin());

-- Cron-hygiëne: historiek van pg_cron niet eindeloos laten groeien.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'watchtower-cron-hygiene') THEN
    PERFORM cron.unschedule('watchtower-cron-hygiene');
  END IF;
  PERFORM cron.schedule('watchtower-cron-hygiene', '41 3 * * *',
    $c$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$c$);
END $$;

-- Grafieken: reactietijd per uur en incidenten per week, server-side samengevat.
CREATE OR REPLACE FUNCTION public.wt_latency_hourly(p_days int DEFAULT 7)
RETURNS TABLE (target_id uuid, hour timestamptz, p50_ms int, checks int, fails int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT s.target_id, date_trunc('hour', s.measured_at) AS hour,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY s.latency_ms)::int AS p50_ms,
         count(*)::int AS checks,
         count(*) FILTER (WHERE s.status = 'fail')::int AS fails
  FROM public.scan_results s
  WHERE s.check_key IN ('http', 'health', 'store')
    AND s.measured_at > now() - make_interval(days => p_days)
    AND s.latency_ms IS NOT NULL
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;
GRANT EXECUTE ON FUNCTION public.wt_latency_hourly(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.wt_incidents_weekly(p_weeks int DEFAULT 8)
RETURNS TABLE (week date, grp text, n int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT date_trunc('week', i.opened_at)::date AS week,
         CASE WHEN w.kind IN ('platform', 'storefront') THEN 'SellQo & winkels'
              WHEN w.kind = 'venture' THEN 'Ventures'
              ELSE 'Klantensites' END AS grp,
         count(*)::int AS n
  FROM public.incidents i
  JOIN public.watch_targets w ON w.id = i.target_id
  WHERE i.opened_at > date_trunc('week', now()) - make_interval(weeks => p_weeks - 1)
    AND i.severity <> 'monitor'
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;
GRANT EXECUTE ON FUNCTION public.wt_incidents_weekly(int) TO authenticated;
