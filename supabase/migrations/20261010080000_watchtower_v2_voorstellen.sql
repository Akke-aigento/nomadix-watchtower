-- Watchtower 2.0 — batch 4: voorstellen die zichzelf schrijven én uitgevoerd worden.
-- Idempotent.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS fingerprint text NULL,
  ADD COLUMN IF NOT EXISTS incident_id uuid NULL REFERENCES public.incidents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS result text NULL,
  ADD COLUMN IF NOT EXISTS executed_at timestamptz NULL;

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('proposed','approved','in_progress','done','failed','rejected'));

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_source_check;
ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_source_check
  CHECK (source IN ('watchtower_scan','claude_session','claude_task'));

CREATE INDEX IF NOT EXISTS proposals_target_fingerprint_idx ON public.proposals (target_id, fingerprint, status);

-- Bij Go: meteen een push "opgepikt" kan pas als de taak draait; de taak meldt zelf.

-- Winkel-check: koppeling target ↔ SellQo-tenant (enkel publieke storefront-leesacties).
ALTER TABLE public.watch_targets ADD COLUMN IF NOT EXISTS sellqo_tenant_id uuid NULL;
UPDATE public.watch_targets SET sellqo_tenant_id = '54f6b480-280b-42e1-b843-d5beb2831acd' WHERE name = 'VanXcel' AND sellqo_tenant_id IS NULL;
UPDATE public.watch_targets SET sellqo_tenant_id = '2606c5b9-caf8-4a42-94cd-80e3f3f31988' WHERE name = 'Mancini Milano' AND sellqo_tenant_id IS NULL;
UPDATE public.watch_targets SET sellqo_tenant_id = '1671a91c-31fe-42ed-8a10-41f3117ceb50' WHERE name = 'Loveke' AND sellqo_tenant_id IS NULL;
UPDATE public.watch_targets SET sellqo_tenant_id = '169cf7b9-b22a-4a94-87d1-fb4b9cc948f9' WHERE name = 'Astra Sleep' AND sellqo_tenant_id IS NULL;
UPDATE public.watch_targets SET sellqo_tenant_id = '05b419c3-d9a4-4ad8-bbf0-2d1c672e266f' WHERE name = 'Zona Dorata' AND sellqo_tenant_id IS NULL;
