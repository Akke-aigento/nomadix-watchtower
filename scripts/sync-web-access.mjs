#!/usr/bin/env node
/**
 * Zet de in Watchtower goedgekeurde domeinen (tabel web_access, status 'toegestaan')
 * in .claude/settings.json, zodat de geplande Watchtower-runs die pagina's mogen lezen
 * zonder telkens toestemming te vragen. Geweigerde domeinen worden verwijderd.
 *
 * Gebruik: node scripts/sync-web-access.mjs '<json>'
 *   <json> = [{"domain":"docs.stripe.com","status":"toegestaan"}, ...]  (uitvoer van:
 *   select json_agg(json_build_object('domain',domain,'status',status)) from web_access)
 * Schrijft enkel WebFetch(domain:…)-regels; laat andere regels in het bestand staan.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const rows = JSON.parse(process.argv[2] ?? "[]");
const path = ".claude/settings.json";
const settings = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
settings.permissions ??= {};
const other = (settings.permissions.allow ?? []).filter((r) => !r.startsWith("WebFetch(domain:"));
const ok = rows
  .filter((r) => r.status === "toegestaan" && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(r.domain))
  .map((r) => `WebFetch(domain:${r.domain.toLowerCase()})`);
settings.permissions.allow = [...new Set([...other, ...ok.sort()])];
writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
console.log(`${ok.length} domeinen toegestaan, ${other.length} andere regels behouden`);
