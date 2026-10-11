-- selftest_runs.total (afgeleid: passed + failed), zodat de assistent het aantal functies leest
-- zonder te rekenen. Idempotent. Terugdraaien: ALTER TABLE public.selftest_runs DROP COLUMN total;
ALTER TABLE public.selftest_runs
  ADD COLUMN IF NOT EXISTS total integer GENERATED ALWAYS AS (passed + failed) STORED;
