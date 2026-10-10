-- Watchtower 2.0 — batch 5b: ingest van de integratie-scanner (scripts/integration-scan.mjs --compact).
-- Eén call per scan: select public.wt_ingest_scan('<json>'::jsonb);
-- JSON: { i: [[key,name,partner,category,versions,docs,changelog,status]], u: [[key,repo,file,version,n]],
--         h: [[host,repos,files]], r: [repo,...] }
-- Nieuwe partners worden geregistreerd (discovered_via='code'); bestaande krijgen last_seen_at = now().
-- Gebruik per gescande repo wordt volledig vervangen. Idempotent.

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
    INSERT INTO public.integrations (key, name, partner, category, used_version, docs_url, changelog_url, status_page_url, discovered_via, last_seen_at)
    VALUES (x->>0, x->>1, x->>2, x->>3, nullif(x->>4, ''), x->>5, x->>6, x->>7, 'code', now())
    ON CONFLICT (key) DO UPDATE SET
      used_version = EXCLUDED.used_version,
      last_seen_at = now(),
      docs_url = coalesce(public.integrations.docs_url, EXCLUDED.docs_url),
      changelog_url = coalesce(public.integrations.changelog_url, EXCLUDED.changelog_url),
      status_page_url = coalesce(public.integrations.status_page_url, EXCLUDED.status_page_url);
  END LOOP;

  FOR x IN SELECT * FROM jsonb_array_elements(scan->'h') LOOP
    INSERT INTO public.integrations (key, name, partner, category, discovered_via, notes, last_seen_at)
    VALUES ('host:' || (x->>0), x->>0, x->>0, 'unclassified', 'code', 'Zelf ontdekt in ' || (x->>1) || ': ' || (x->>2), now())
    ON CONFLICT (key) DO UPDATE SET last_seen_at = now();
  END LOOP;

  DELETE FROM public.integration_usages
  WHERE repo IN (SELECT jsonb_array_elements_text(scan->'r'));

  INSERT INTO public.integration_usages (integration_key, repo, file, version, occurrences)
  SELECT u->>0, u->>1, u->>2, coalesce(u->>3, ''), (u->>4)::int
  FROM jsonb_array_elements(scan->'u') u
  WHERE EXISTS (SELECT 1 FROM public.integrations i WHERE i.key = u->>0)
  ON CONFLICT (integration_key, repo, file, version) DO UPDATE SET occurrences = EXCLUDED.occurrences, scanned_at = now();

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
