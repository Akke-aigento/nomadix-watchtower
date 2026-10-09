-- Watchtower 2.0 — batch 1: fundament
-- 1) status 'unknown' (meting mislukt) naast ok/warn/fail
-- 2) incidenten: één incident per probleem, met tijdlijn en "erkend tot"
-- 3) RLS: enkel admins (allowlist) i.p.v. elke ingelogde gebruiker
-- 4) helper-RPC voor de laatste N resultaten per target+check
-- 5) scan-cron van */30 naar */10 (per-check frequentie zit in de code)
-- Idempotent: veilig om opnieuw te draaien.

-- ============ 1. unknown-status ============
ALTER TABLE public.scan_results DROP CONSTRAINT IF EXISTS scan_results_status_check;
ALTER TABLE public.scan_results
  ADD CONSTRAINT scan_results_status_check CHECK (status IN ('ok','warn','fail','unknown'));

CREATE INDEX IF NOT EXISTS scan_results_target_check_measured_idx
  ON public.scan_results (target_id, check_key, measured_at DESC);

-- ============ 2. admins-allowlist ============
CREATE TABLE IF NOT EXISTS public.watchtower_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.watchtower_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.watchtower_admins FROM anon, authenticated;
GRANT ALL ON public.watchtower_admins TO service_role;

INSERT INTO public.watchtower_admins (user_id)
SELECT id FROM auth.users WHERE lower(email) = 'akke@studioakke.com'
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_watchtower_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.watchtower_admins WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_watchtower_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_watchtower_admin() TO authenticated, service_role;

-- ============ 3. incidenten ============
CREATE TABLE IF NOT EXISTS public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES public.watch_targets(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('actie','aandacht','monitor')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  title text NOT NULL,
  summary text NULL,
  detail jsonb NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  acknowledged_until timestamptz NULL,
  acknowledged_note text NULL,
  notified_at timestamptz NULL,
  last_reminder_at timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS incidents_one_open_per_check
  ON public.incidents (target_id, check_key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS incidents_status_opened_idx ON public.incidents (status, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.incident_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  kind text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incident_events_incident_idx ON public.incident_events (incident_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.incidents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incident_events TO authenticated;
GRANT ALL ON public.incidents TO service_role;
GRANT ALL ON public.incident_events TO service_role;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_events ENABLE ROW LEVEL SECURITY;

-- ============ 4. RLS: enkel admins ============
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['watch_targets','scan_results','daily_summaries','alert_log','proposals','incidents','incident_events']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all_authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_watchtower_admin()) WITH CHECK (public.is_watchtower_admin())',
      t || '_admin_all', t
    );
  END LOOP;
END $$;

-- ============ 5. laatste N resultaten per target+check ============
CREATE OR REPLACE FUNCTION public.wt_recent_results(n int DEFAULT 3)
RETURNS TABLE (
  target_id uuid,
  check_key text,
  status text,
  latency_ms int,
  detail jsonb,
  measured_at timestamptz,
  rn int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_id, check_key, status, latency_ms, detail, measured_at, rn::int
  FROM (
    SELECT r.*, row_number() OVER (PARTITION BY r.target_id, r.check_key ORDER BY r.measured_at DESC) AS rn
    FROM public.scan_results r
    WHERE r.measured_at > now() - interval '21 days'
  ) x
  WHERE x.rn <= n;
$$;
REVOKE ALL ON FUNCTION public.wt_recent_results(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wt_recent_results(int) TO service_role;

-- ============ 6. scan-cron elke 10 minuten ============
SELECT cron.schedule(
  'watchtower-run-scans',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nomadix-watchtower.lovable.app/api/public/run-scans',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',public.get_cron_secret()),
    body := '{}'::jsonb, timeout_milliseconds := 300000);
  $$
);
