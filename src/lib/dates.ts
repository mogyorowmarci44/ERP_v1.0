/** Mai dátum Budapest szerint, YYYY-MM-DD. */
export function today(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(new Date());
}

export function monthStart(d = today()): string {
  return d.slice(0, 8) + "01";
}

export function monthEnd(d = today()): string {
  const [y, m] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${d.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

export function yearStart(d = today()): string {
  return d.slice(0, 4) + "-01-01";
}

export function isDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function fmtDate(d: string | null | undefined): string {
  return d ? d.replaceAll("-", ".") + "." : "";
}

export function addDaysIso(d: string, days: number): string {
  return new Date(Date.parse(d + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}
