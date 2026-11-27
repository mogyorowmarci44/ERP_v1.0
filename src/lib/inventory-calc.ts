/**
 * v6.3.0 – Készletértékelés csúsztatott (folyamatosan súlyozott) átlagáron – tiszta függvények.
 *
 * Mozgások (dátum, majd rögzítési sorrend szerint):
 *  - in:  bevételezés szállítói számláról (mennyiség + beszerzési érték) → az átlagár újraszámolódik
 *  - out: kiadás vevőszámláról → az aktuális átlagáron csökkenti a készletet (ez az ELÁBÉ)
 *  - opening / adjust: nyitó készlet és leltári eltérés; pozitív mennyiség a megadott (vagy az aktuális) egységáron
 *    növel, negatív az átlagáron csökkent.
 * Negatív mennyiségű számlasor (visszáru) előjelhelyesen működik: visszavett áru az átlagáron jön vissza,
 * visszaküldött beszerzés a saját egységárán csökkenti a készletet.
 */
export type MoveKind = "in" | "out" | "opening" | "adjust";
export type Move = {
  key: string;
  itemId: number;
  date: string;
  kind: MoveKind;
  /** Mindig a számlán / mozgáson szereplő előjel szerint (out: eladott mennyiség pozitív). */
  quantity: number;
  /** Bevételezésnél a nettó beszerzési érték Ft-ban; nyitó / többlet mozgásnál egységár × mennyiség. */
  value?: number | null;
  ref?: string;
};

export type ValuedMove = Move & { qtyDelta: number; valueDelta: number; unitCost: number; balanceQty: number; balanceValue: number };
export type ItemBalance = { qty: number; value: number; avg: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function sortMoves(moves: Move[]): Move[] {
  const order: Record<MoveKind, number> = { opening: 0, in: 1, adjust: 2, out: 3 };
  return [...moves].sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/** Egy cikk mozgásainak értékelése (a bemenet bármilyen sorrendű lehet). */
export function valueMoves(moves: Move[]): { moves: ValuedMove[]; balance: ItemBalance } {
  let qty = 0;
  let value = 0;
  const out: ValuedMove[] = [];
  for (const m of sortMoves(moves)) {
    const avg = qty > 0 ? value / qty : 0;
    let qd = 0;
    let vd = 0;
    if (m.kind === "in") {
      qd = m.quantity;
      vd = m.value ?? 0;
    } else if (m.kind === "out") {
      qd = -m.quantity;
      vd = -m.quantity * avg;
    } else {
      qd = m.quantity;
      vd = m.quantity > 0 ? (m.value != null ? m.value : m.quantity * avg) : m.quantity * avg;
    }
    qty = r4(qty + qd);
    value = r2(value + vd);
    // teljesen kiürült készletnél ne maradjon kerekítési maradék
    if (qty === 0) value = 0;
    out.push({ ...m, qtyDelta: r4(qd), valueDelta: r2(vd), unitCost: qd !== 0 ? r4(Math.abs(vd / qd)) : 0, balanceQty: qty, balanceValue: value });
  }
  return { moves: out, balance: { qty, value, avg: qty > 0 ? r4(value / qty) : 0 } };
}

/** Az eladott áruk beszerzési értéke (ELÁBÉ) egy időszakban – a vevőszámlás kiadások értéke. */
export function cogsInPeriod(valued: ValuedMove[], from: string, to: string): number {
  return r2(valued.filter((m) => m.kind === "out" && m.date >= from && m.date <= to).reduce((s, m) => s - m.valueDelta, 0));
}

/** Egy időpontig érvényes egyenleg. */
export function balanceAt(valued: ValuedMove[], date: string): ItemBalance {
  const last = [...valued].filter((m) => m.date <= date).pop();
  if (!last) return { qty: 0, value: 0, avg: 0 };
  return { qty: last.balanceQty, value: last.balanceValue, avg: last.balanceQty > 0 ? r4(last.balanceValue / last.balanceQty) : 0 };
}
