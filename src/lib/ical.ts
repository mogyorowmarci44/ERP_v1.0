/** v2.0 – Airbnb iCal-naptár feldolgozása (tiszta függvény). */
export type IcalEvent = { start: string; end: string; summary: string; code: string | null };

export function parseIcal(text: string): IcalEvent[] {
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const out: IcalEvent[] = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const get = (k: string) => block.match(new RegExp(`^${k}[^:\\n]*:(.*)$`, "m"))?.[1]?.trim() ?? "";
    const d = (s: string) => (/^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "");
    const start = d(get("DTSTART")), end = d(get("DTEND"));
    if (!start || !end || end <= start) continue;
    const code = get("DESCRIPTION").match(/reservations\/details\/([A-Z0-9]+)/)?.[1] ?? null;
    out.push({ start, end, summary: get("SUMMARY"), code });
  }
  return out;
}

