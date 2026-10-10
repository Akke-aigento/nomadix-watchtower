/** iCalendar (RFC 5545) voor de Watchtower-agenda. Puur, zonder I/O. */

export type AgendaRow = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  kind: string;
  severity: string;
  source_url: string | null;
};

const KIND_PREFIX: Record<string, string> = {
  sunset: "⏳",
  token: "🔑",
  certificate: "🔒",
  domain: "🌐",
  subscription: "💳",
  migration: "🛠",
  other: "📌",
};

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Lijnen > 75 octetten vouwen (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (curLen + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      curLen = 0;
    }
    cur += ch;
    curLen += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function ymd(d: string): string {
  return d.slice(0, 10).replace(/-/g, "");
}

function nextDay(d: string): string {
  const t = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10).replace(/-/g, "");
}

function alarm(daysBefore: number, text: string): string[] {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(text)}`, `TRIGGER:-P${daysBefore}D`, "END:VALARM"];
}

export function buildIcs(items: AgendaRow[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nomadix//Watchtower//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Watchtower",
    "X-WR-CALDESC:Deadlines van alle Nomadix-koppelingen\\, certificaten en domeinen",
    "X-WR-TIMEZONE:Europe/Brussels",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const it of items) {
    const title = `${KIND_PREFIX[it.kind] ?? "📌"} ${it.title}`;
    const desc = [it.description ?? "", it.source_url ? `Bron: ${it.source_url}` : "", "Watchtower: https://nomadix-watchtower.lovable.app/agenda"]
      .filter(Boolean)
      .join("\n\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${it.id}@watchtower.nomadix`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(it.due_date)}`,
      `DTEND;VALUE=DATE:${nextDay(it.due_date)}`,
      `SUMMARY:${esc(title)}`,
      `DESCRIPTION:${esc(desc)}`,
      "TRANSP:TRANSPARENT",
      `CATEGORIES:${esc(it.kind)}`,
      ...(it.source_url ? [`URL:${it.source_url}`] : []),
      ...alarm(30, it.title),
      ...alarm(7, it.title),
      ...(it.severity === "actie" ? alarm(1, it.title) : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
