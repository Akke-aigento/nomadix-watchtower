-- Watchtower 2.0 — voorstellenpakketten: één vondst → alle plekken die geraakt worden
-- (code, koppelflow, marketing, helpartikels, tenants, strategie), als genummerd pakket.
-- Idempotent.
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS bundle text NULL,
  ADD COLUMN IF NOT EXISTS bundle_order int NULL,
  ADD COLUMN IF NOT EXISTS bundle_title text NULL;
CREATE INDEX IF NOT EXISTS proposals_bundle_idx ON public.proposals (bundle);
