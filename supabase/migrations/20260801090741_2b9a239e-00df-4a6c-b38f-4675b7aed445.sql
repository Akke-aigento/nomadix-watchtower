ALTER TABLE public.watch_targets
  ADD COLUMN IF NOT EXISTS health_url text,
  ADD COLUMN IF NOT EXISTS health_token text;

UPDATE public.watch_targets
SET checks = coalesce(checks, '{}'::jsonb) || '{"health":true}'::jsonb,
    health_url = 'https://tvynbrtmohuciybwwzzl.supabase.co/functions/v1/health'
WHERE name = 'Nomadix Inbox';

SELECT cron.schedule(
  'watchtower-morning-brief',
  '30 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://nomadix-watchtower.lovable.app/api/public/morning-brief',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.get_cron_secret()),
    body := '{}'::jsonb
  ) as request_id;
  $$
);