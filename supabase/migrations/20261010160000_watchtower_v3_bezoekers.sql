-- Watchtower v3 — bezoekers per site (Lovable-analytics).
-- site_analytics_daily : per site per dag bezoekers, paginaweergaven, bouncepercentage, sessieduur (minuten).
-- site_analytics_lists : per site en periode (7/30/90 d) de toplijsten: pagina's, bronnen, toestellen, landen.
-- Gevuld door de geplande Watchtower-ronde via de Lovable-connector (get_project_analytics), 0 credits.
-- Idempotent. Terugdraaien: DROP TABLE site_analytics_daily, site_analytics_lists;

CREATE TABLE IF NOT EXISTS public.site_analytics_daily (
  target_id uuid NOT NULL REFERENCES public.watch_targets(id) ON DELETE CASCADE,
  day date NOT NULL,
  visitors int NOT NULL DEFAULT 0,
  pageviews int NOT NULL DEFAULT 0,
  bounce_rate numeric NULL,
  session_min numeric NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_id, day)
);

CREATE TABLE IF NOT EXISTS public.site_analytics_lists (
  target_id uuid NOT NULL REFERENCES public.watch_targets(id) ON DELETE CASCADE,
  period_days int NOT NULL CHECK (period_days IN (7, 30, 90)),
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  devices jsonb NOT NULL DEFAULT '[]'::jsonb,
  countries jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_id, period_days)
);

ALTER TABLE public.site_analytics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_analytics_lists ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_analytics_daily, public.site_analytics_lists TO authenticated;
GRANT ALL ON public.site_analytics_daily, public.site_analytics_lists TO service_role;
DROP POLICY IF EXISTS site_analytics_daily_admin ON public.site_analytics_daily;
CREATE POLICY site_analytics_daily_admin ON public.site_analytics_daily FOR ALL TO authenticated
  USING (public.is_watchtower_admin()) WITH CHECK (public.is_watchtower_admin());
DROP POLICY IF EXISTS site_analytics_lists_admin ON public.site_analytics_lists;
CREATE POLICY site_analytics_lists_admin ON public.site_analytics_lists FOR ALL TO authenticated
  USING (public.is_watchtower_admin()) WITH CHECK (public.is_watchtower_admin());

-- Ingest in één call: {"t": "<target_id>", "days": [[day, visitors, pageviews, bounce, session_min], ...],
--                      "lists": {"7": {pages, sources, devices, countries}, "30": {...}, "90": {...}}}
CREATE OR REPLACE FUNCTION public.wt_ingest_analytics(p jsonb)
RETURNS int LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE n int := 0; k text;
BEGIN
  INSERT INTO site_analytics_daily (target_id, day, visitors, pageviews, bounce_rate, session_min, fetched_at)
  SELECT (p->>'t')::uuid, (d->>0)::date, (d->>1)::int, (d->>2)::int, nullif(d->>3,'')::numeric, nullif(d->>4,'')::numeric, now()
  FROM jsonb_array_elements(coalesce(p->'days','[]'::jsonb)) d
  ON CONFLICT (target_id, day) DO UPDATE SET visitors = excluded.visitors, pageviews = excluded.pageviews,
    bounce_rate = excluded.bounce_rate, session_min = excluded.session_min, fetched_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  FOR k IN SELECT jsonb_object_keys(coalesce(p->'lists','{}'::jsonb)) LOOP
    INSERT INTO site_analytics_lists (target_id, period_days, pages, sources, devices, countries, fetched_at)
    VALUES ((p->>'t')::uuid, k::int,
      coalesce(p->'lists'->k->'pages','[]'), coalesce(p->'lists'->k->'sources','[]'),
      coalesce(p->'lists'->k->'devices','[]'), coalesce(p->'lists'->k->'countries','[]'), now())
    ON CONFLICT (target_id, period_days) DO UPDATE SET pages = excluded.pages, sources = excluded.sources,
      devices = excluded.devices, countries = excluded.countries, fetched_at = now();
  END LOOP;
  RETURN n;
END $$;
