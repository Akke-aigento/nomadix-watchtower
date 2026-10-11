-- Baken krijgt een brein: vrij lezen in Watchtower (read-only), een geheugen, en een eigen
-- token voor de servertools die ElevenLabs aanroept. Idempotent.
-- Terugdraaien: DROP FUNCTION wt_baken_query(text), get_baken_tool_token(); DROP TABLE baken_memory;
-- DELETE FROM private.config WHERE key = 'baken_tool_token'.

CREATE TABLE IF NOT EXISTS public.baken_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feit text NOT NULL CHECK (length(feit) BETWEEN 3 AND 400),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.baken_memory ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.baken_memory TO authenticated;
GRANT ALL ON public.baken_memory TO service_role;
DROP POLICY IF EXISTS baken_memory_admin_all ON public.baken_memory;
CREATE POLICY baken_memory_admin_all ON public.baken_memory FOR ALL TO authenticated
  USING (public.is_watchtower_admin()) WITH CHECK (public.is_watchtower_admin());

-- Token voor de webhooktools (ElevenLabs → /api/baken-tool). Waarde enkel in private.config.
INSERT INTO private.config (key, value)
SELECT 'baken_tool_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE NOT EXISTS (SELECT 1 FROM private.config WHERE key = 'baken_tool_token');

CREATE OR REPLACE FUNCTION public.get_baken_tool_token()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, public AS $$
  SELECT value FROM private.config WHERE key = 'baken_tool_token';
$$;
REVOKE ALL ON FUNCTION public.get_baken_tool_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_baken_tool_token() TO service_role;

-- Vrij lezen: één SELECT, read-only transactie, 4 s, max 60 rijen, geen geheime schema's of functies.
CREATE OR REPLACE FUNCTION public.wt_baken_query(q text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  clean text := regexp_replace(btrim(coalesce(q, '')), ';\s*$', '');
  r jsonb;
BEGIN
  IF clean = '' THEN RAISE EXCEPTION 'lege query'; END IF;
  IF position(';' IN clean) > 0 THEN RAISE EXCEPTION 'één query tegelijk'; END IF;
  IF clean !~* '^\s*(select|with)\M' THEN RAISE EXCEPTION 'enkel SELECT'; END IF;
  -- Geen schrijfwerk, geen dynamische SQL, geen geheime schema's, functies of instellingen.
  -- Aanhalingstekens rond namen zijn verboden (anders omzeil je de namenlijst met "private".config).
  IF position('"' IN clean) > 0
     OR clean ~* 'u&'
     OR clean ~* '\m(insert|update|delete|merge|alter|drop|create|grant|revoke|truncate|copy|call|do|lock|refresh|vacuum|analyze|notify|listen|prepare|execute|set_config|current_setting|dblink\w*|lo_\w+|pg_read\w*|pg_ls\w*|pg_stat_file|pg_sleep\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate\w*|\w+_to_xml\w*|xpath\w*)\M'
     OR clean ~* '\m(private|auth|vault|cron|net|storage|supabase_functions|supabase_migrations|extensions|graphql|graphql_public|realtime|pgsodium|pg_catalog)\s*\.'
     OR clean ~* '\m(get_[a-z_]+|watchtower_admins|push_subscriptions|pg_authid|pg_shadow|pg_user_mapping\w*)\M'
  THEN
    RAISE EXCEPTION 'niet toegestaan in Baken-lezen';
  END IF;
  SET LOCAL transaction_read_only = on;
  SET LOCAL statement_timeout = '4s';
  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) s LIMIT 60) t', clean) INTO r;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.wt_baken_query(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wt_baken_query(text) TO service_role;
