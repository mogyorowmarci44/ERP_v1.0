/** KészletMérleg – az Eladott fül időszaka: elmúlt 12 hónap (alap), idei év, tavalyi év vagy egyéni. */
import { addDaysIso, isDate, today } from "@/lib/dates";
import { rangeLabel } from "@/lib/period-picker";

export type PeriodKey = "12m" | "ytd" | "prev" | "custom";
export function periodOf(sp: Record<string, string | undefined>): { key: PeriodKey; from: string; to: string; label: string } {
  const t = today(), y = Number(t.slice(0, 4));
  if (sp.p === "ytd") return { key: "ytd", from: `${y}-01-01`, to: t, label: `${y}` };
  if (sp.p === "prev") return { key: "prev", from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `${y - 1}` };
  if (sp.p === "custom" && isDate(sp.from) && isDate(sp.to)) return { key: "custom", from: sp.from!, to: sp.to!, label: rangeLabel("day", sp.from!, sp.to!) };
  return { key: "12m", from: addDaysIso(t, -365), to: t, label: "Elmúlt 12 hónap" };
}
