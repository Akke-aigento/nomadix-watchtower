-- wt_ingest_scan: touchpoints enkel bijwerken voor koppelingen waar ze echt veranderen.
-- Aanleiding: via PostgREST (route /api/public/ingest-scan) faalde de oude UPDATE zonder WHERE
-- (safeupdate op de authenticator-rol). Een gerichte WHERE schrijft bovendien minder rijen.
-- Enige wijziging t.o.v. 20261010120000_watchtower_v2_vondstenmotor.sql: de touchpoints-update.
-- Idempotent. Terugdraaien: de functie uit 20261010120000 opnieuw draaien.
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

  WITH tp AS (
    SELECT i.key, coalesce((
      SELECT jsonb_object_agg(kind, n) FROM (
        SELECT kind, count(*) AS n FROM public.integration_usages u WHERE u.integration_key = i.key GROUP BY kind
      ) s), '{}'::jsonb) AS touchpoints
    FROM public.integrations i
  )
  UPDATE public.integrations i SET touchpoints = tp.touchpoints
  FROM tp
  WHERE tp.key = i.key AND i.touchpoints IS DISTINCT FROM tp.touchpoints;


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
