-- Watchtower 2.0 — batch 3: dagstatus per check voor de 30-dagenbalken.
-- SECURITY INVOKER: RLS op scan_results (enkel admins) blijft gelden.
DROP FUNCTION IF EXISTS public.wt_daily_check_status(uuid, int);
CREATE FUNCTION public.wt_daily_check_status(p_target uuid, p_days int DEFAULT 30)
RETURNS TABLE (day date, check_key text, ok int, warn int, fail int, unknown int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT (measured_at AT TIME ZONE 'Europe/Brussels')::date AS day, check_key,
    count(*) FILTER (WHERE status = 'ok')::int,
    count(*) FILTER (WHERE status = 'warn')::int,
    count(*) FILTER (WHERE status = 'fail')::int,
    count(*) FILTER (WHERE status = 'unknown')::int
  FROM public.scan_results
  WHERE target_id = p_target AND measured_at > now() - make_interval(days => p_days)
  GROUP BY 1, 2
  ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.wt_daily_check_status(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wt_daily_check_status(uuid, int) TO authenticated, service_role;
