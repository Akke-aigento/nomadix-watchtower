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
