import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Single source of truth for the cron secret: private.config (key = 'cron_secret'),
 * read through a security-definer function with the service role client.
 * process.env.CRON_SECRET stays valid as an alternative when it is set.
 *
 * Een haperende DB-lookup mag geen geldige cron-run weigeren: 1 retry en een
 * cache van 5 minuten per worker-instantie.
 */
let cached: { value: string; at: number } | null = null;
const TTL_MS = 5 * 60_000;

async function lookup(): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabaseAdmin.rpc("get_cron_secret");
    if (!error && typeof data === "string" && data) return data;
    if (error) console.error(`cron secret lookup failed (poging ${attempt + 1})`, error);
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

export async function isValidCronSecret(provided: string): Promise<boolean> {
  const envSecret = process.env.CRON_SECRET;
  if (envSecret && provided === envSecret) return true;

  if (cached && Date.now() - cached.at < TTL_MS && provided === cached.value) return true;
  const expected = await lookup();
  if (!expected) return false;
  cached = { value: expected, at: Date.now() };
  return provided === expected;
}
