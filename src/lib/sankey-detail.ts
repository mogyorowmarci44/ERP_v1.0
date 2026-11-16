/**
 * Sankey részletező fa. Költségkategória → főkönyvi számla → szállító → bizonylat (számla);
 * egyszámlás kategóriánál a számla-szint kimarad. ELÁBÉ → gépkocsi → szállító (beszerzés, fuvar, honosítás …) → bizonylat.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { journalLines, journalEntries, accounts, vehicles, partners, invoices, companies } = schema;
export type DetailItem = { key: string; label: string; value: number; children?: DetailItem[] };
/** Szülő csomópont (P&L sor kulcsa) → a kibontáskor megjelenő tételek (tetszőleges mélységig). */
export type SankeyDetail = Partial<Record<string, DetailItem[]>>;

const MAX_ITEMS = 7;
/** A legnagyobb tételek + „egyéb” összevonás, csak pozitív értékek. */
function top(items: DetailItem[], restLabel: string): DetailItem[] {
  const pos = items.filter((x) => x.value >= 1).sort((a, b) => b.value - a.value);
  if (pos.length <= MAX_ITEMS + 1) return pos;
  const rest = pos.slice(MAX_ITEMS);
  return [...pos.slice(0, MAX_ITEMS), { key: "rest", label: `${restLabel} (${rest.length} db)`, value: rest.reduce((s, x) => s + x.value, 0) }];
}

type Row = { accCode: string; accName: string; pid: number | null; pname: string | null; eid: number; enumber: string; edate: string; invNo: string | null; desc: string | null; v: number };
type Level = "account" | "partner" | "doc";

const docLabel = (r: Row) => {
  const doc = r.invNo ?? r.enumber;
  const d = r.edate.slice(5).replace("-", ".") + ".";
  const txt = r.desc ? ` – ${r.desc}` : "";
  return `${doc} (${d})${txt}`;
};

/** Sorokból fa a megadott szintek szerint. */
function tree(rows: Row[], levels: Level[], rest: string): DetailItem[] {
  if (!levels.length || !rows.length) return [];
  const [lv, ...more] = levels;
  const groups = new Map<string, { label: string; rows: Row[] }>();
  for (const r of rows) {
    const key = lv === "account" ? r.accCode : lv === "partner" ? (r.pid ? `p${r.pid}` : "nop") : `e${r.eid}`;
    const label = lv === "account" ? `${r.accCode} ${r.accName}` : lv === "partner" ? r.pname ?? "Partner nélkül" : docLabel(r);
    const g = groups.get(key) ?? { label, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const items: DetailItem[] = [...groups.entries()].map(([key, g]) => {
    const value = Math.round(g.rows.reduce((s, r) => s + r.v, 0));
    const children = more.length ? tree(g.rows, more, more[0] === "doc" ? "További bizonylatok" : "Egyéb") : undefined;
    return { key, label: g.label, value, children: children?.length ? children : undefined };
  });
  return top(items, lv === "partner" ? "Egyéb szállítók" : lv === "doc" ? "További bizonylatok" : rest);
}

async function lineRows(where: ReturnType<typeof and>) {
  const rows = await db
    .select({
      accCode: accounts.code, accName: accounts.name, pid: partners.id, pname: partners.name,
      eid: journalEntries.id, enumber: journalEntries.number, edate: journalEntries.date, invNo: invoices.invoiceNumber,
      desc: journalLines.description, debit: journalLines.debit, credit: journalLines.credit, vehicleId: journalLines.vehicleId,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .leftJoin(partners, eq(partners.id, journalLines.partnerId))
    .leftJoin(invoices, and(eq(invoices.id, journalEntries.sourceId), sql`${journalEntries.sourceType} = 'invoice'`))
    .where(where);
  return rows.map((r) => ({ ...r, v: Number(r.debit) - Number(r.credit) }));
}

export async function sankeyDetail(companyId: number, from: string, to: string): Promise<SankeyDetail> {
  const period = and(eq(journalLines.companyId, companyId), gte(journalEntries.date, from), lte(journalEntries.date, to));
  const rows: Row[] = await lineRows(and(period, sql`(${accounts.code} like '5%' or ${accounts.code} like '8%')`));

  const other5 = (c: string) => c.startsWith("5") && !["51", "52", "53", "54", "55", "56", "57", "58", "59"].some((p) => c.startsWith(p));
  const p = (...xs: string[]) => (c: string) => xs.some((x) => c.startsWith(x));
  const level = (pred: (c: string) => boolean, rest: string) => {
    const sel = rows.filter((r) => pred(r.accCode));
    const accCount = new Set(sel.filter((r) => Math.abs(r.v) >= 1).map((r) => r.accCode)).size;
    return tree(sel, accCount > 1 ? ["account", "partner", "doc"] : ["partner", "doc"], rest);
  };

  // ELÁBÉ gépkocsinként; az autó alatt a bekerülési érték összetevői (készletre aktivált tételek) szállító → bizonylat szerint
  const elabe = (await lineRows(and(period, sql`(${accounts.code} like '811%' or ${accounts.code} like '812%' or ${accounts.code} like '813%' or ${accounts.code} like '814%')`)));
  const byVeh = new Map<number | null, number>();
  for (const r of elabe) byVeh.set(r.vehicleId, (byVeh.get(r.vehicleId) ?? 0) + r.v);
  const vIds = [...byVeh.keys()].filter((x): x is number => !!x);
  const vrows = vIds.length ? await db.select().from(vehicles).where(inArray(vehicles.id, vIds)) : [];
  const [company] = await db.select({ s: companies.settings }).from(companies).where(eq(companies.id, companyId));
  const inv = company?.s?.inventoryGoods ?? "261";
  const caps = vIds.length
    ? (await lineRows(and(eq(journalLines.companyId, companyId), inArray(journalLines.vehicleId, vIds), sql`${accounts.code} like ${inv + "%"}`, sql`${journalLines.debit} > 0`)))
    : [];
  const veh: DetailItem[] = [...byVeh.entries()].map(([id, value]) => {
    const v = vrows.find((x) => x.id === id);
    const label = v ? `${v.make} ${v.model}${v.plate ? ` (${v.plate})` : v.vin ? ` (…${v.vin.slice(-6)})` : ""}` : "Gépkocsihoz nem rendelt";
    const comp = id ? caps.filter((c) => c.vehicleId === id) : [];
    return { key: id ? `v${id}` : "none", label, value: Math.round(value), children: comp.length ? tree(comp, ["partner", "doc"], "Egyéb") : undefined };
  });

  return {
    IV5: level(p("51"), "Egyéb anyag"),
    IV6: level((c) => c.startsWith("52") || other5(c), "Egyéb szolgáltatás"),
    IV7: level(p("53"), "Egyéb"),
    IV8: top(veh, "További autók"),
    IV9: level(p("815", "816", "817"), "Egyéb"),
    V: level(p("54", "55", "56"), "Egyéb"),
    VI: level(p("57"), "Egyéb"),
    VII: level((c) => c.startsWith("8") && !["81", "87", "89"].some((x) => c.startsWith(x)), "Egyéb ráfordítás"),
    IX: level(p("87"), "Egyéb"),
  };
}
