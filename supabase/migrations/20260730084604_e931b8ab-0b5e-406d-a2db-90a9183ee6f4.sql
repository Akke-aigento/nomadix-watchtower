
-- ============ TABLES ============
CREATE TABLE public.watch_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('platform','storefront','client_site','venture')),
  url text NOT NULL,
  lovable_project_id uuid NULL,
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily','weekly')),
  enabled boolean NOT NULL DEFAULT true,
  checks jsonb NOT NULL DEFAULT '{"http":true,"ssl":true,"dns":false,"form_smoke":false}'::jsonb,
  form_smoke_url text NULL,
  notes text NULL,
  status text NOT NULL DEFAULT 'unknown',
  last_scanned_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watch_targets TO authenticated;
GRANT ALL ON public.watch_targets TO service_role;
ALTER TABLE public.watch_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "watch_targets_all_authenticated" ON public.watch_targets FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.scan_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES public.watch_targets(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','warn','fail')),
  latency_ms int NULL,
  detail jsonb NULL,
  measured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scan_results_target_measured_idx ON public.scan_results (target_id, measured_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_results TO authenticated;
GRANT ALL ON public.scan_results TO service_role;
ALTER TABLE public.scan_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_results_all_authenticated" ON public.scan_results FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.daily_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES public.watch_targets(id) ON DELETE CASCADE,
  day date NOT NULL,
  uptime_pct numeric NULL,
  avg_latency_ms int NULL,
  fail_count int NOT NULL DEFAULT 0,
  UNIQUE (target_id, day)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_summaries TO authenticated;
GRANT ALL ON public.daily_summaries TO service_role;
ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_summaries_all_authenticated" ON public.daily_summaries FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES public.watch_targets(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  transition text NOT NULL,
  mailed boolean NOT NULL DEFAULT false,
  detail jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_log_created_idx ON public.alert_log (created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_log TO authenticated;
GRANT ALL ON public.alert_log TO service_role;
ALTER TABLE public.alert_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alert_log_all_authenticated" ON public.alert_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NULL REFERENCES public.watch_targets(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('bug','improvement','security')),
  title text NOT NULL,
  description text NOT NULL,
  proposed_action text NOT NULL,
  source text NOT NULL DEFAULT 'claude_session' CHECK (source IN ('watchtower_scan','claude_session')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposals TO authenticated;
GRANT ALL ON public.proposals TO service_role;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proposals_all_authenticated" ON public.proposals FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ SEED ============
INSERT INTO public.watch_targets (name, kind, url, lovable_project_id, frequency, checks) VALUES
('Sellqo platform','platform','https://sellqo.app','9932a7fe-43a1-42de-9c64-168968599600','daily','{"http":true,"ssl":true,"dns":true,"form_smoke":false}'),
('Mancini Milano','storefront','https://mancinimilano.com','2c89fac8-7e27-461d-b7e5-bc5563030937','daily','{"http":true,"ssl":true,"dns":true,"form_smoke":false}'),
('Loveke','storefront','https://loveke.be','fb495500-8e4d-40f9-b43d-49f116bb70ab','daily','{"http":true,"ssl":true,"dns":true,"form_smoke":false}'),
('VanXcel','storefront','https://vanxcel.com','80408260-c0d8-4f90-a4c4-58c9202792e0','daily','{"http":true,"ssl":true,"dns":true,"form_smoke":false}'),
('Zona Dorata','storefront','https://zona-dorata.lovable.app','19045cee-d7ee-4dbc-8e2c-b698490fa4b6','daily','{"http":true,"ssl":true,"dns":false,"form_smoke":false}'),
('Astra Sleep','storefront','https://astra-sleep.lovable.app','1953cd3a-359d-4bdc-8022-be2ec34feab4','daily','{"http":true,"ssl":true,"dns":false,"form_smoke":false}'),
('Yeketi Motorworks','client_site','https://yeketimotorworks.com','4fee59e8-4094-4b2a-b9f2-be1a7f65993a','weekly','{"http":true,"ssl":true,"dns":true,"form_smoke":false}'),
('Borletti','client_site','https://borletti.lovable.app','53a02d43-dff4-4490-91c0-d1077b2b520e','weekly','{"http":true,"ssl":true,"dns":false,"form_smoke":false}'),
('Gil Bosmans','client_site','https://gil-bosmans-gallery.lovable.app','cef209ab-d913-46b3-b752-678901f5586a','weekly','{"http":true,"ssl":true,"dns":false,"form_smoke":false}'),
('Senaeve Tuinwerken','client_site','https://senaeve-tuinwerken.lovable.app','7b9d6005-2c24-4bf2-8e38-cd566c50b148','weekly','{"http":true,"ssl":true,"dns":false,"form_smoke":false}'),
('Portal Studio Akke','client_site','https://portal-studioakke.lovable.app','b04ad1d8-235c-4930-a875-88177771360b','weekly','{"http":true,"ssl":true,"dns":false,"form_smoke":false}'),
('Studio Akke','venture','https://studioakke.lovable.app','829764eb-4017-4e4c-8c50-a2d87899c26b','weekly','{"http":true,"ssl":true,"dns":false,"form_smoke":false}'),
('Toog','venture','https://toog.lovable.app','7ec2f754-837b-4e42-a963-cb319c8df68a','weekly','{"http":true,"ssl":true,"dns":false,"form_smoke":false}'),
('Nomadix Inbox','venture','https://nomadix-inbox.lovable.app','4eb51e4d-d845-4d68-b789-89893faa490c','weekly','{"http":true,"ssl":true,"dns":false,"form_smoke":false}'),
('De Fiere Margriet','venture','https://de-fiere-margriet.lovable.app','12129848-b387-4477-8d94-dd890436c244','daily','{"http":true,"ssl":true,"dns":false,"form_smoke":false}'),
('Goudhaan','venture','https://goudhaan.lovable.app','e95c8dae-2c30-4f6c-a322-f28c1436e0ab','weekly','{"http":true,"ssl":true,"dns":false,"form_smoke":false}');

-- ============ PRIVATE CONFIG FOR CRON SECRET ============
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.config (
  key text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON SCHEMA private FROM anon, authenticated;
REVOKE ALL ON private.config FROM anon, authenticated;
INSERT INTO private.config (key, value) VALUES ('cron_secret','CHANGE_ME')
ON CONFLICT (key) DO NOTHING;

-- ============ CRON ============
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'watchtower-run-scans',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--b9945398-c9e9-49cc-bc0b-97a3b0757531.lovable.app/api/public/run-scans',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM private.config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'watchtower-daily-rollup',
  '15 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--b9945398-c9e9-49cc-bc0b-97a3b0757531.lovable.app/api/public/daily-rollup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM private.config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
