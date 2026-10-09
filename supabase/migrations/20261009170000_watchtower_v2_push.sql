-- Watchtower 2.0 — batch 2: pushmeldingen
-- De VAPID-sleutels zelf staan in private.config (vapid_private_jwk / vapid_public_key)
-- en zijn rechtstreeks in de live-DB gezet — NOOIT in deze repo.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.get_vapid_private_jwk()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public
AS $$
  SELECT value FROM private.config WHERE key = 'vapid_private_jwk' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_vapid_private_jwk() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vapid_private_jwk() TO service_role;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz NULL,
  failure_count int NOT NULL DEFAULT 0
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
DROP POLICY IF EXISTS push_subscriptions_admin_all ON public.push_subscriptions;
CREATE POLICY push_subscriptions_admin_all ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (public.is_watchtower_admin())
  WITH CHECK (public.is_watchtower_admin());
