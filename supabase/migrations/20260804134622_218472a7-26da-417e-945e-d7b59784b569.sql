REVOKE ALL ON FUNCTION public.get_heartbeat_url() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_heartbeat_url() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;