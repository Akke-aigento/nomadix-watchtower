/** Leesbare foutmelding, ook voor Supabase/PostgREST-fouten (gewone objecten met message/code). */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.code, o.details, o.hint].filter((x) => typeof x === "string" && x);
    if (parts.length) return parts.join(" | ");
    try {
      return JSON.stringify(e).slice(0, 500);
    } catch {
      /* val terug */
    }
  }
  return String(e);
}
