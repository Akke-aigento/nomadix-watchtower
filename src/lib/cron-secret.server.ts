import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Single source of truth for the cron secret: private.config (key = 'cron_secret'),
 * read through a security-definer function with the service role client.
 * process.env.CRON_SECRET stays valid as an alternative when it is set.
 */
export async function isValidCronSecret(provided: string): Promise<boolean> {
  const envSecret = process.env.CRON_SECRET;
  if (envSecret && provided === envSecret) return true;

  const { data, error } = await supabaseAdmin.rpc("get_cron_secret");
  if (error) {
    console.error("cron secret lookup failed", error);
    return false;
  }
  const expected = typeof data === "string" ? data : null;
  return !!expected && provided === expected;
}
