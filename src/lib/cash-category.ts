/** v2.0 – Pénzmozgások kategorizálása (tiszta függvények, adatbázis nélkül). */
export type CashCategory = "revenue" | "expense" | "tax" | "private" | "transfer" | "other";

export const CASH_CATEGORY_LABEL: Record<CashCategory, string> = {
  revenue: "Bevétel",
  expense: "Kiadás",
  tax: "Adó / járulék / IFA",
  private: "Magánszféra",
  transfer: "Átvezetés",
  other: "Egyéb",
};

/** Ellenszámla kódja alapján a pénzmozgás kategóriája. */
export function categorize(counterCodes: string[]): CashCategory {
  const has = (...p: string[]) => counterCodes.some((c) => p.some((x) => c.startsWith(x)));
  if (counterCodes.length === 0 || counterCodes.every((c) => c.startsWith("38"))) return "transfer";
  if (has("419", "411")) return "private";
  if (has("462", "463", "467", "468")) return "tax";
  if (has("91", "969", "972", "311", "316", "453")) return "revenue";
  if (has("5", "8", "1", "2", "454", "455", "351", "466")) return "expense";
  return "other";
}
