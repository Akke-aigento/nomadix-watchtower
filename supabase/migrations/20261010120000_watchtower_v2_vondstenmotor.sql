-- Watchtower 2.0 — vondstenmotor: elke koppeling wordt periodiek onderzocht, elke vondst
-- wordt vastgelegd en krijgt een impactpakket, en Watchtower bewaakt zelf dat niets blijft liggen.
--
-- findings              : wat de radar (of een incident / ontdekking) vond, met bron en analyse
-- integrations          : + pricing_url, review_days, radar_note, touchpoints (impactkaart per soort)
-- integration_usages    : + kind (code | beheer | marketing | helpartikel) — waar in de keten een partner voorkomt
-- radar_coverage (view) : per koppeling: wanneer opnieuw onderzoeken, achterstallig of niet
-- wt_engine_health()    : zelfcontrole van de motor (achterstallige radar, vondsten zonder pakket)
-- Idempotent. Terugdraaien: DROP VIEW radar_coverage; DROP FUNCTION wt_engine_health(); DROP TABLE findings;
-- de extra kolommen mogen blijven.

ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS pricing_url text NULL,
  ADD COLUMN IF NOT EXISTS review_days int NULL,
  ADD COLUMN IF NOT EXISTS radar_note text NULL,
  ADD COLUMN IF NOT EXISTS touchpoints jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.integration_usages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'code';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integration_usages_kind_check') THEN
    ALTER TABLE public.integration_usages
      ADD CONSTRAINT integration_usages_kind_check CHECK (kind IN ('code', 'beheer', 'marketing', 'helpartikel'));
  END IF;
END $$;

-- Een bestand kan code én beheerscherm zijn: kind hoort bij de sleutel.
ALTER TABLE public.integration_usages DROP CONSTRAINT IF EXISTS integration_usages_integration_key_repo_file_version_key;
DROP INDEX IF EXISTS public.integration_usages_integration_key_repo_file_version_key;
CREATE UNIQUE INDEX IF NOT EXISTS integration_usages_uniq ON public.integration_usages (integration_key, repo, file, version, kind);

CREATE TABLE IF NOT EXISTS public.findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  integration_key text NULL,
  kind text NOT NULL CHECK (kind IN ('deprecation', 'breaking_change', 'pricing', 'plan', 'security', 'policy', 'outage_pattern', 'new_integration', 'opportunity')),
  title text NOT NULL,
  summary text NOT NULL,
  analysis text NULL,
  impact text NOT NULL DEFAULT 'onzeker' CHECK (impact IN ('raakt_ons', 'raakt_ons_niet', 'onzeker')),
  severity text NOT NULL DEFAULT 'aandacht' CHECK (severity IN ('info', 'aandacht', 'actie')),
  affected_tenants int NULL,
  source_url text NOT NULL,
  source_published date NULL,
  effective_date date NULL,
  status text NOT NULL DEFAULT 'nieuw' CHECK (status IN ('nieuw', 'pakket', 'opgelost', 'verworpen')),
  bundle text NULL,
  detected_by text NOT NULL DEFAULT 'radar' CHECK (detected_by IN ('radar', 'ontdekking', 'incident', 'data', 'akke')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS findings_status_idx ON public.findings (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS findings_integration_idx ON public.findings (integration_key);
CREATE INDEX IF NOT EXISTS findings_bundle_idx ON public.findings (bundle);

ALTER TABLE public.findings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.findings TO authenticated;
GRANT ALL ON public.findings TO service_role;
DROP POLICY IF EXISTS findings_admin_all ON public.findings;
CREATE POLICY findings_admin_all ON public.findings FOR ALL TO authenticated
  USING (public.is_watchtower_admin()) WITH CHECK (public.is_watchtower_admin());

-- Hoe vaak opnieuw onderzoeken: actief 7 dagen, slapend 30, risico 'actie' 3, anders 14.
CREATE OR REPLACE VIEW public.radar_coverage WITH (security_invoker = true) AS
SELECT
  i.key, i.name, i.partner, i.usage_state, i.risk, i.radar_checked_at, i.radar_note,
  coalesce(i.review_days,
    CASE WHEN i.risk = 'actie' THEN 3
         WHEN i.usage_state = 'active' THEN 7
         WHEN i.usage_state = 'dormant' THEN 30
         ELSE 14 END) AS review_days_effective,
  (i.radar_checked_at IS NULL OR i.radar_checked_at < now() - make_interval(days =>
    coalesce(i.review_days,
      CASE WHEN i.risk = 'actie' THEN 3 WHEN i.usage_state = 'active' THEN 7 WHEN i.usage_state = 'dormant' THEN 30 ELSE 14 END)))
    AS due
FROM public.integrations i
WHERE i.category <> 'unclassified' OR i.usage_state = 'active';
GRANT SELECT ON public.radar_coverage TO authenticated, service_role;

-- Zelfcontrole van de motor. Telt als "achterstallig" pas na één dag speling.
CREATE OR REPLACE FUNCTION public.wt_engine_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'integrations', (SELECT count(*) FROM radar_coverage),
    'checked_7d', (SELECT count(*) FROM radar_coverage WHERE radar_checked_at > now() - interval '7 days'),
    'overdue', (SELECT count(*) FROM radar_coverage
                WHERE radar_checked_at IS NULL OR radar_checked_at < now() - make_interval(days => review_days_effective + 1)),
    'overdue_active', (SELECT count(*) FROM radar_coverage
                WHERE usage_state = 'active' AND (radar_checked_at IS NULL OR radar_checked_at < now() - make_interval(days => review_days_effective + 1))),
    'findings_7d', (SELECT count(*) FROM findings WHERE detected_at > now() - interval '7 days'),
    'findings_open', (SELECT count(*) FROM findings WHERE status = 'nieuw' AND impact <> 'raakt_ons_niet'),
    'unbundled', (SELECT count(*) FROM findings
                  WHERE status = 'nieuw' AND impact = 'raakt_ons' AND severity IN ('aandacht', 'actie')
                    AND bundle IS NULL AND detected_at < now() - interval '24 hours'),
    'last_radar_at', (SELECT max(radar_checked_at) FROM integrations)
  );
$$;
GRANT EXECUTE ON FUNCTION public.wt_engine_health() TO authenticated, service_role;

-- Ingest: usages krijgen een soort (6e element), touchpoints worden per koppeling samengevat.
CREATE OR REPLACE FUNCTION public.wt_ingest_scan(scan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before_keys text[];
  new_keys text[];
  x jsonb;
BEGIN
  SELECT coalesce(array_agg(key), '{}') INTO before_keys FROM public.integrations;

  FOR x IN SELECT * FROM jsonb_array_elements(scan->'i') LOOP
    INSERT INTO public.integrations (key, name, partner, category, used_version, docs_url, changelog_url, status_page_url, pricing_url, discovered_via, last_seen_at)
    VALUES (x->>0, x->>1, x->>2, x->>3, nullif(x->>4, ''), x->>5, x->>6, x->>7, x->>8, 'code', now())
    ON CONFLICT (key) DO UPDATE SET
      used_version = coalesce(EXCLUDED.used_version, public.integrations.used_version),
      last_seen_at = now(),
      docs_url = coalesce(public.integrations.docs_url, EXCLUDED.docs_url),
      changelog_url = coalesce(public.integrations.changelog_url, EXCLUDED.changelog_url),
      status_page_url = coalesce(public.integrations.status_page_url, EXCLUDED.status_page_url),
      pricing_url = coalesce(public.integrations.pricing_url, EXCLUDED.pricing_url);
  END LOOP;

  FOR x IN SELECT * FROM jsonb_array_elements(scan->'h') LOOP
    INSERT INTO public.integrations (key, name, partner, category, discovered_via, notes, last_seen_at)
    VALUES ('host:' || (x->>0), x->>0, x->>0, 'unclassified', 'code', 'Zelf ontdekt in ' || (x->>1) || ': ' || (x->>2), now())
    ON CONFLICT (key) DO UPDATE SET last_seen_at = now();
  END LOOP;

  DELETE FROM public.integration_usages
  WHERE repo IN (SELECT jsonb_array_elements_text(scan->'r'));

  INSERT INTO public.integration_usages (integration_key, repo, file, version, occurrences, kind)
  SELECT u->>0, u->>1, u->>2, coalesce(u->>3, ''), (u->>4)::int, coalesce(u->>5, 'code')
  FROM jsonb_array_elements(scan->'u') u
  WHERE EXISTS (SELECT 1 FROM public.integrations i WHERE i.key = u->>0)
  ON CONFLICT (integration_key, repo, file, version, kind) DO UPDATE SET occurrences = EXCLUDED.occurrences, scanned_at = now();

  UPDATE public.integrations i SET touchpoints = coalesce((
    SELECT jsonb_object_agg(kind, n) FROM (
      SELECT kind, count(*) AS n FROM public.integration_usages u WHERE u.integration_key = i.key GROUP BY kind
    ) s), '{}'::jsonb);

  SELECT coalesce(array_agg(key), '{}') INTO new_keys FROM public.integrations WHERE NOT (key = ANY (before_keys));

  RETURN jsonb_build_object(
    'integrations', (SELECT count(*) FROM public.integrations),
    'new', to_jsonb(new_keys),
    'usages', (SELECT count(*) FROM public.integration_usages)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.wt_ingest_scan(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wt_ingest_scan(jsonb) TO service_role;
