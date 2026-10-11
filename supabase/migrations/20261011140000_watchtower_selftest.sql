-- Zelftest van alle Watchtower-functies (route /api/public/selftest, elke 3 uur). Idempotent.
-- Terugdraaien: SELECT cron.unschedule('watchtower-selftest'); DROP TABLE public.selftest_runs;
CREATE TABLE IF NOT EXISTS public.selftest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  passed int NOT NULL,
  failed int NOT NULL,
  results jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS selftest_runs_ran_at_idx ON public.selftest_runs (ran_at DESC);
ALTER TABLE public.selftest_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.selftest_runs TO authenticated;
GRANT ALL ON public.selftest_runs TO service_role;
DROP POLICY IF EXISTS selftest_runs_admin_read ON public.selftest_runs;
CREATE POLICY selftest_runs_admin_read ON public.selftest_runs FOR SELECT TO authenticated
  USING (public.is_watchtower_admin());
