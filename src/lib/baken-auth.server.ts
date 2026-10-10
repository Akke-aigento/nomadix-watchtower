/** Enkel ingelogde Watchtower-admins mogen Baken gebruiken (Bearer-token van Supabase). */
export async function isBakenAdmin(request: Request): Promise<boolean> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || token.split(".").length !== 3) return false;
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: user } = await sb.auth.getUser(token);
  if (!user.user) return false;
  const { data } = await sb.rpc("is_watchtower_admin");
  return data === true;
}

/** De ElevenLabs-sleutel zoals de Lovable-connector hem in het project zet (naam kan variëren). */
export function elevenKey(): string | null {
  const direct =
    process.env.ELEVENLABS_API_KEY ?? process.env.ELEVEN_LABS_API_KEY ?? process.env.XI_API_KEY;
  if (direct) return direct;
  const name = Object.keys(process.env).find((k) => /ELEVEN/i.test(k) && /KEY/i.test(k));
  return name ? (process.env[name] ?? null) : null;
}
