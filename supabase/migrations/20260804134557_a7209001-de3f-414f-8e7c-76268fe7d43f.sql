INSERT INTO private.config (key, value) VALUES ('heartbeat_url', '') ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_heartbeat_url()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'private', 'public'
AS $$
  SELECT value FROM private.config WHERE key = 'heartbeat_url' LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_heartbeat_url() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_heartbeat_url() TO service_role;