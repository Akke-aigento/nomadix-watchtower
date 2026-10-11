-- Baken kan voorstellen aanmaken vanuit een gesprek (bron 'baken'). Idempotent.
-- Terugdraaien: constraint terugzetten zonder 'baken' (eerst bestaande baken-rijen omzetten).
ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_source_check;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_source_check
  CHECK (source = ANY (ARRAY['watchtower_scan', 'claude_session', 'claude_task', 'baken']));
