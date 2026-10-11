-- Ochtendbrief-verzending loggen: één rij per echte verzendpoging (geen dry-runs, geen
-- "niet 07:xx"-skips). De bewaker leest dit i.p.v. net._http_response (bewaart ~6 u).
-- Idempotent. Terugdraaien: DROP TABLE public.brief_log;
CREATE TABLE IF NOT EXISTS public.brief_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Brussels')::date,
  sent boolean NOT NULL,
  channel text NOT NULL DEFAULT 'mail',
  forced boolean NOT NULL DEFAULT false,
  subject text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brief_log_day_idx ON public.brief_log (day DESC, created_at DESC);

ALTER TABLE public.brief_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brief_log_admin_read ON public.brief_log;
CREATE POLICY brief_log_admin_read ON public.brief_log FOR SELECT TO authenticated
  USING (public.is_watchtower_admin());
REVOKE ALL ON public.brief_log FROM anon;
GRANT SELECT ON public.brief_log TO authenticated;
GRANT ALL ON public.brief_log TO service_role;
