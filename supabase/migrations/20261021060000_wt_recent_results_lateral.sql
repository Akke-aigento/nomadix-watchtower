-- credits-202610: wt_recent_results zonder window over 21 dagen scan_results.
-- Meting 21-10-2026: 613 ms per aanroep (26k buffers), ~130 aanroepen/dag = ~75% van de
-- DB-rekentijd van Watchtower. Per (target, check) een index-lookup met limit: 10,7 ms,
-- identieke 224 rijen (except-vergelijking in beide richtingen 0).
CREATE OR REPLACE FUNCTION public.wt_recent_results(n integer DEFAULT 3)
 RETURNS TABLE(target_id uuid, check_key text, status text, latency_ms integer, detail jsonb, measured_at timestamp with time zone, rn integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT x.target_id, x.check_key, x.status, x.latency_ms, x.detail, x.measured_at, x.rn::int
  FROM (SELECT DISTINCT s.target_id, s.check_key FROM public.scan_results s
        WHERE s.measured_at > now() - interval '21 days') k
  CROSS JOIN LATERAL (
    SELECT r.target_id, r.check_key, r.status, r.latency_ms, r.detail, r.measured_at,
           row_number() OVER (ORDER BY r.measured_at DESC) AS rn
    FROM public.scan_results r
    WHERE r.target_id = k.target_id AND r.check_key = k.check_key
      AND r.measured_at > now() - interval '21 days'
    ORDER BY r.measured_at DESC
    LIMIT n) x;
$function$;
