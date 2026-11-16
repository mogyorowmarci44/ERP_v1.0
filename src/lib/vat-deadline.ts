/** A következő ÁFA-bevallási határidő a bevallási gyakoriság szerint (havi/negyedéves: 20-a, éves: febr. 25.). */
export function nextVatDeadline(period: string, t: string): string {
  const [y, m, d] = t.split("-").map(Number);
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  if (period === "yearly") return m < 2 || (m === 2 && d <= 25) ? iso(y, 2, 25) : iso(y + 1, 2, 25);
  const months = period === "quarterly" ? [1, 4, 7, 10] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  for (const mm of months) if (mm > m || (mm === m && d <= 20)) return iso(y, mm, 20);
  return iso(y + 1, 1, 20);
}
