/** v4.4.0 – Tagi kölcsön: hány napja járt le / hány nap múlva jár le, súlyossági fokozattal. */
export type LoanAge = { kind: "over" | "soon"; days: number; level: "fresh" | "late" | "old" | "soon"; label: string };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export function loanAge(dueDate: string | null | undefined, status: string | null | undefined, t: string): LoanAge | null {
  if (!dueDate) return null;
  if (status === "Lejárt") {
    const days = Math.max(1, daysBetween(dueDate, t));
    return { kind: "over", days, level: days > 180 ? "old" : days > 30 ? "late" : "fresh", label: `lejárt · ${days} napja` };
  }
  if (status === "Hamarosan lejár") {
    const days = daysBetween(t, dueDate);
    return { kind: "soon", days, level: "soon", label: days <= 0 ? "ma jár le" : `${days} nap múlva jár le` };
  }
  return null;
}
