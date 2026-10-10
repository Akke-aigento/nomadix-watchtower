-- Watchtower 2.0 — batch 5: Integratie-radar + agenda.
-- integrations       : register van elke externe koppeling (zelf ontdekt via code, data of projecten)
-- integration_usages : waar in welke repo/bestand een koppeling gebruikt wordt (+ versie)
-- agenda_items       : deadlines (sunsets, tokens, abonnementen, handmatig) — ssl/domein komen live uit scan_results
-- agenda (view)      : agenda_items ∪ certificaten ∪ domeinnamen, voor de app en de ICS-feed
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  partner text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  used_version text NULL,
  latest_version text NULL,
  usage_state text NOT NULL DEFAULT 'unknown' CHECK (usage_state IN ('active','dormant','unknown')),
  active_tenants int NULL,
  last_activity_at timestamptz NULL,
  risk text NOT NULL DEFAULT 'ok' CHECK (risk IN ('ok','aandacht','actie')),
  risk_note text NULL,
  discovered_via text NOT NULL DEFAULT 'manual' CHECK (discovered_via IN ('code','data','project','manual')),
  discovered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  docs_url text NULL,
  changelog_url text NULL,
  status_page_url text NULL,
  upstream_indicator text NULL,
  upstream_description text NULL,
  upstream_checked_at timestamptz NULL,
  radar_checked_at timestamptz NULL,
  notes text NULL
);

CREATE TABLE IF NOT EXISTS public.integration_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key text NOT NULL REFERENCES public.integrations(key) ON UPDATE CASCADE ON DELETE CASCADE,
  repo text NOT NULL,
  file text NOT NULL,
  version text NOT NULL DEFAULT '',
  occurrences int NOT NULL DEFAULT 1,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_key, repo, file, version)
);

CREATE TABLE IF NOT EXISTS public.agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NULL,
  due_date date NOT NULL,
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('sunset','token','certificate','domain','subscription','migration','other')),
  severity text NOT NULL DEFAULT 'aandacht' CHECK (severity IN ('info','aandacht','actie')),
  integration_key text NULL REFERENCES public.integrations(key) ON UPDATE CASCADE ON DELETE SET NULL,
  target_id uuid NULL REFERENCES public.watch_targets(id) ON DELETE CASCADE,
  source_url text NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agenda_items_due_idx ON public.agenda_items (status, due_date);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integrations','integration_usages','agenda_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_watchtower_admin()) WITH CHECK (public.is_watchtower_admin())', t || '_admin_all', t);
  END LOOP;
END $$;

-- Eén agenda: handmatige/ontdekte items + live certificaten en domeinnamen.
CREATE OR REPLACE VIEW public.agenda WITH (security_invoker = true) AS
  SELECT a.id::text AS id, a.title, a.description, a.due_date, a.kind, a.severity,
         a.integration_key, a.target_id, a.source_url, a.status, 'agenda'::text AS origin
  FROM public.agenda_items a
  UNION ALL
  SELECT 'scan-' || r.check_key || '-' || r.target_id::text,
         CASE WHEN r.check_key = 'domain' THEN 'Domeinnaam ' || coalesce(r.detail->>'domain', w.name) || ' verloopt'
              ELSE 'Certificaat ' || coalesce(r.detail->>'host', w.name) || ' verloopt' END,
         CASE WHEN r.check_key = 'domain' THEN 'Check of auto-renew aan staat bij de registrar.'
              ELSE 'Wordt normaal automatisch vernieuwd; Watchtower meldt het als dat niet gebeurt.' END,
         (r.detail->>'expires_at')::timestamptz::date,
         CASE WHEN r.check_key = 'domain' THEN 'domain' ELSE 'certificate' END,
         CASE WHEN (r.detail->>'days_left')::int < 14 THEN 'actie'
              WHEN (r.detail->>'days_left')::int < 45 THEN 'aandacht' ELSE 'info' END,
         NULL, r.target_id, NULL, 'open', 'scan'
  FROM (
    SELECT DISTINCT ON (target_id, check_key) target_id, check_key, detail
    FROM public.scan_results
    WHERE check_key IN ('ssl','domain') AND status <> 'unknown' AND detail ? 'expires_at'
    ORDER BY target_id, check_key, measured_at DESC
  ) r
  JOIN public.watch_targets w ON w.id = r.target_id;
GRANT SELECT ON public.agenda TO authenticated, service_role;

-- Token voor de abonneerbare ICS-feed (staat enkel in private.config; nooit in de repo).
-- Bij uitrol eenmalig: insert into private.config (key, value) values ('agenda_token', '<random>') on conflict do nothing;
CREATE OR REPLACE FUNCTION public.get_agenda_token()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, public AS $$
  -- service_role (ICS-route) of een Watchtower-admin (toont de abonneer-link); anderen krijgen NULL.
  SELECT value FROM private.config
  WHERE key = 'agenda_token' AND (auth.role() = 'service_role' OR public.is_watchtower_admin())
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_agenda_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agenda_token() TO authenticated, service_role;
