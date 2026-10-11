import { createFileRoute } from "@tanstack/react-router";

/**
 * Servertools van Baken. ElevenLabs roept deze route aan tijdens een gesprek (webhook-tools),
 * met het eigen token uit private.config (x-baken-token). Nooit vanuit de browser.
 *
 *   ?t=lees      { sql }                         vrij lezen in Watchtower (read-only, zie wt_baken_query)
 *   ?t=beslis    { voorstel, besluit }           go/afwijzen op een voorstel (Baken vraagt eerst bevestiging)
 *   ?t=erken     { incident, dagen, reden }      incident erkennen voor x dagen
 *   ?t=onthoud   { feit }                        iets onthouden voor volgende gesprekken
 *   ?t=vergeet   { feit }                        iets vergeten
 */
let tokenCache: { value: string; at: number } | null = null;

async function validToken(provided: string | null): Promise<boolean> {
  if (!provided) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!tokenCache || Date.now() - tokenCache.at > 300_000) {
    const { data } = await supabaseAdmin.rpc("get_baken_tool_token");
    if (typeof data === "string" && data) tokenCache = { value: data, at: Date.now() };
  }
  if (!tokenCache) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(tokenCache.value);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const ok = (data: unknown) => Response.json({ ok: true, data });
const fail = (message: string) => Response.json({ ok: false, fout: message });

/** Zoekt één voorstel op id of op (een stuk van) de titel. */
async function findProposal(ref: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const isId = /^[0-9a-f-]{36}$/i.test(ref);
  const q = supabaseAdmin.from("proposals").select("id, title, status, bundle, bundle_order");
  const { data } = isId
    ? await q.eq("id", ref)
    : await q
        .ilike("title", `%${ref.replace(/[%_]/g, " ").trim()}%`)
        .in("status", ["proposed", "failed"]);
  return data ?? [];
}

export const Route = createFileRoute("/api/baken-tool")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await validToken(request.headers.get("x-baken-token"))))
          return new Response("Unauthorized", { status: 401 });
        const tool = new URL(request.url).searchParams.get("t") ?? "";
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          /* leeg */
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (tool === "lees") {
          const sql = String(body.sql ?? "").slice(0, 4000);
          const { data, error } = await supabaseAdmin.rpc("wt_baken_query", { q: sql });
          if (error) return fail(`${error.message} — pas de query aan en probeer opnieuw.`);
          const rows = (data ?? []) as unknown[];
          const text = JSON.stringify(rows);
          return ok({
            rijen: rows.length,
            resultaat: text.length > 12000 ? JSON.parse(JSON.stringify(rows.slice(0, 20))) : rows,
            afgekapt: text.length > 12000 || rows.length >= 60,
          });
        }

        if (tool === "beslis") {
          const besluit = String(body.besluit ?? "").toLowerCase();
          const status = besluit === "go" ? "approved" : besluit === "afwijzen" ? "rejected" : null;
          if (!status) return fail("besluit moet 'go' of 'afwijzen' zijn");
          const hits = await findProposal(String(body.voorstel ?? ""));
          if (hits.length !== 1)
            return fail(
              hits.length
                ? `Meerdere voorstellen passen: ${hits.map((h) => h.title).join(" | ")}. Vraag welk.`
                : "Geen open voorstel gevonden met die naam.",
            );
          const p = hits[0];
          const { error } = await supabaseAdmin
            .from("proposals")
            .update({ status, decided_at: new Date().toISOString() })
            .eq("id", p.id);
          if (error) return fail(error.message);
          return ok({
            voorstel: p.title,
            status,
            uitleg:
              status === "approved"
                ? "Go gegeven. De Watchtower-assistent voert het uit bij zijn volgende ronde (rond 8u, 13u of 19u)."
                : "Afgewezen.",
          });
        }

        if (tool === "erken") {
          const id = String(body.incident ?? "");
          const dagen = Math.min(60, Math.max(1, Number(body.dagen ?? 1) || 1));
          const until = new Date(Date.now() + dagen * 86400000).toISOString();
          const { data, error } = await supabaseAdmin
            .from("incidents")
            .update({
              acknowledged_until: until,
              acknowledged_note: String(body.reden ?? "Erkend via Baken").slice(0, 200),
            })
            .eq("id", id)
            .eq("status", "open")
            .select("id, title");
          if (error) return fail(error.message);
          if (!data?.length)
            return fail("Geen open incident met die id. Zoek het eerst op met lees.");
          await supabaseAdmin.from("incident_events").insert({
            incident_id: id,
            kind: "acknowledged",
            message: `Erkend via Baken voor ${dagen} dag(en)`,
          });
          return ok({ incident: data[0].title, erkend_tot: until });
        }

        if (tool === "onthoud") {
          const feit = String(body.feit ?? "")
            .trim()
            .slice(0, 400);
          if (feit.length < 3) return fail("leeg feit");
          const { error } = await supabaseAdmin.from("baken_memory").insert({ feit });
          if (error) return fail(error.message);
          return ok({ onthouden: feit });
        }

        if (tool === "vergeet") {
          const feit = String(body.feit ?? "").trim();
          const { data, error } = await supabaseAdmin
            .from("baken_memory")
            .delete()
            .ilike("feit", `%${feit.replace(/[%_]/g, " ")}%`)
            .select("feit");
          if (error) return fail(error.message);
          return ok({ vergeten: (data ?? []).map((d) => d.feit) });
        }

        return fail(`onbekende tool ${tool}`);
      },
    },
  },
});
