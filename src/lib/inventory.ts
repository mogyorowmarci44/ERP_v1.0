import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@/db";
import { accountIdByCode, manualEntry } from "@/lib/ledger";
import { cogsInPeriod, valueMoves, type Move, type ValuedMove } from "@/lib/inventory-calc";
import { round2 } from "@/lib/money";

/**
 * v6.3.0 – Készletnyilvántartás adatai: a mozgások a könyvelt (nem sztornózott) számlák cikkes soraiból és a kézi
 * mozgásokból (nyitó, leltári eltérés) állnak össze; az értékelés csúsztatott átlagáron, mindig újraszámolva.
 */
const { items, stockMoves, stockCogs, invoices, invoiceLines } = schema;

export async function companyMoves(cid: number, itemId?: number, conn: DbOrTx = db): Promise<Move[]> {
  const invRows = await conn
    .select({
      id: invoiceLines.id, itemId: invoiceLines.itemId, quantity: invoiceLines.quantity, netHuf: invoiceLines.netHuf,
      date: invoices.fulfillmentDate, issueDate: invoices.issueDate, direction: invoices.direction, number: invoices.invoiceNumber, invoiceId: invoices.id,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(eq(invoices.companyId, cid), eq(invoices.status, "posted"), itemId ? eq(invoiceLines.itemId, itemId) : sql`${invoiceLines.itemId} is not null`));
  const manual = await conn.select().from(stockMoves).where(and(eq(stockMoves.companyId, cid), itemId ? eq(stockMoves.itemId, itemId) : sql`true`));
  return [
    ...invRows.map((r): Move => ({
      key: `i${r.id}`, itemId: r.itemId!, date: r.date ?? r.issueDate, kind: r.direction === "in" ? "in" : "out",
      quantity: Number(r.quantity), value: r.direction === "in" ? Number(r.netHuf) : null, ref: `${r.number}#${r.invoiceId}`,
    })),
    ...manual.map((r): Move => ({
      key: `m${r.id}`, itemId: r.itemId, date: r.date, kind: r.kind, quantity: Number(r.quantity),
      value: r.unitCost != null && Number(r.quantity) > 0 ? round2(Number(r.unitCost) * Number(r.quantity)) : null, ref: r.note ?? (r.kind === "opening" ? "nyitó készlet" : "leltári eltérés"),
    })),
  ];
}

export type ItemRow = typeof items.$inferSelect & { qty: number; value: number; avg: number; low: boolean };

/** Cikkek egyenleggel (értékelés a teljes mozgástörténetből). */
export async function itemsWithBalance(cid: number): Promise<ItemRow[]> {
  const [list, moves] = await Promise.all([
    db.select().from(items).where(eq(items.companyId, cid)).orderBy(asc(items.name)),
    companyMoves(cid),
  ]);
  const by = new Map<number, Move[]>();
  for (const m of moves) by.set(m.itemId, [...(by.get(m.itemId) ?? []), m]);
  return list.map((it) => {
    const b = valueMoves(by.get(it.id) ?? []).balance;
    return { ...it, ...b, low: it.minQty != null && b.qty < Number(it.minQty) };
  });
}

/**
 * Havi ELÁBÉ számlapáronként (készletszámla → ELÁBÉ-számla): számított (a hónap vevőszámlás kiadásainak átlagáras értéke),
 * lekönyvelt, különbözet.
 */
export async function monthlyCogs(cid: number, year: number) {
  const [list, moves, booked] = await Promise.all([
    db.select({ id: items.id, cogs: items.cogsAccount, stock: items.stockAccount }).from(items).where(eq(items.companyId, cid)),
    companyMoves(cid),
    db.select().from(stockCogs).where(and(eq(stockCogs.companyId, cid), sql`${stockCogs.period} like ${`${year}-%`}`)),
  ]);
  const byItem = new Map<number, Move[]>();
  for (const m of moves) byItem.set(m.itemId, [...(byItem.get(m.itemId) ?? []), m]);
  const valued = new Map<number, ValuedMove[]>();
  for (const [id, ms] of byItem) valued.set(id, valueMoves(ms).moves);
  const months = [];
  for (let mo = 1; mo <= 12; mo++) {
    const period = `${year}-${String(mo).padStart(2, "0")}`;
    const from = `${period}-01`;
    const to = `${period}-${new Date(Date.UTC(year, mo, 0)).getUTCDate()}`;
    const pairs = new Map<string, { stock: string; cogs: string; computed: number; booked: number; diff: number }>();
    const pair = (stock: string, cogs: string) => {
      const k = `${stock}>${cogs}`;
      if (!pairs.has(k)) pairs.set(k, { stock, cogs, computed: 0, booked: 0, diff: 0 });
      return pairs.get(k)!;
    };
    for (const it of list) {
      const v = cogsInPeriod(valued.get(it.id) ?? [], from, to);
      if (v !== 0) pair(it.stock, it.cogs).computed = round2(pair(it.stock, it.cogs).computed + v);
    }
    for (const b of booked.filter((x) => x.period === period)) pair(b.stockAccount, b.cogsAccount).booked = round2(pair(b.stockAccount, b.cogsAccount).booked + Number(b.amount));
    for (const p of pairs.values()) p.diff = round2(p.computed - p.booked);
    const sumOf = (k: "computed" | "booked" | "diff") => round2([...pairs.values()].reduce((s, p) => s + p[k], 0));
    months.push({ period, from, to, computed: sumOf("computed"), booked: sumOf("booked"), diff: sumOf("diff"), pairs: [...pairs.values()] });
  }
  return months;
}

/**
 * Egy hónap ELÁBÉ-különbözetének könyvelése számlapáronként (T ELÁBÉ / K készlet; negatív különbözetnél fordítva), a hónap
 * utolsó napjára. Csak a különbözet könyvelődik, így utólagos sztornó / visszadátumozott számla után is újra futtatható.
 */
export async function postMonthlyCogs(cid: number, period: string, userId: number) {
  const year = Number(period.slice(0, 4));
  const m = (await monthlyCogs(cid, year)).find((x) => x.period === period);
  if (!m) throw new Error("Ismeretlen időszak.");
  const todo = m.pairs.filter((p) => Math.abs(p.diff) >= 0.5);
  if (!todo.length) throw new Error("Nincs könyvelendő különbözet.");
  return db.transaction(async (tx) => {
    const lines: { accountId: number; debit: number; credit: number; description: string }[] = [];
    for (const p of todo) {
      const [sId, cId] = await Promise.all([accountIdByCode(tx, cid, p.stock), accountIdByCode(tx, cid, p.cogs)]);
      const amt = Math.abs(p.diff);
      lines.push(
        p.diff > 0 ? { accountId: cId, debit: amt, credit: 0, description: `ELÁBÉ ${period}` } : { accountId: cId, debit: 0, credit: amt, description: `ELÁBÉ helyesbítés ${period}` },
        p.diff > 0 ? { accountId: sId, debit: 0, credit: amt, description: `Készletcsökkenés ${period}` } : { accountId: sId, debit: amt, credit: 0, description: `Készlet visszavezetés ${period}` },
      );
    }
    const e = await manualEntry(cid, { journalCode: "VN", date: m.to, description: `Eladott áruk beszerzési értéke (csúsztatott átlagár) – ${period}`, lines, sourceType: "stock_cogs" }, userId, tx);
    await tx.insert(stockCogs).values(todo.map((p) => ({ companyId: cid, period, stockAccount: p.stock, cogsAccount: p.cogs, amount: p.diff, journalEntryId: e.id })));
    return { amount: round2(todo.reduce((s, p) => s + p.diff, 0)), entryId: e.id };
  });
}

/** Új cikk alapértelmezett számlái: gépkocsi-modul mellett alkatrész (262 / 811), különben áru (261 / 814). */
export async function defaultAccounts(cid: number) {
  const [c] = await db.select({ settings: schema.companies.settings, profile: schema.companies.activityProfile }).from(schema.companies).where(eq(schema.companies.id, cid));
  const car = (c?.settings as { modules?: { vehicles?: boolean } })?.modules?.vehicles ?? c?.profile === "car_dealer";
  return car ? { stock: "262", cogs: "811" } : { stock: c?.settings?.inventoryGoods || "261", cogs: c?.settings?.cogs || "814" };
}
