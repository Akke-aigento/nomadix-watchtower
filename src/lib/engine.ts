/** Zelfcontrole van de vondstenmotor (public.wt_engine_health). Puur: bruikbaar in app én server. */
export type EngineHealth = {
  integrations: number;
  checked_7d: number;
  overdue: number;
  overdue_active: number;
  findings_7d: number;
  findings_open: number;
  unbundled: number;
  last_radar_at: string | null;
};

/** Eén regel over de vondstenmotor, en of die zelf aandacht nodig heeft. */
export function engineLine(h: EngineHealth | undefined): { text: string; warn: boolean } {
  if (!h) return { text: "radar laden…", warn: false };
  const parts = [`${h.checked_7d}/${h.integrations} koppelingen onderzocht deze week`];
  if (h.overdue_active) parts.push(`${h.overdue_active} actieve achterstallig`);
  if (h.unbundled) parts.push(`${h.unbundled} vondst(en) zonder pakket`);
  if (!h.last_radar_at) parts.push("radar heeft nog niet gedraaid");
  return { text: parts.join(" · "), warn: !!(h.overdue_active || h.unbundled || !h.last_radar_at) };
}
