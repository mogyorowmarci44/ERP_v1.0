/**
 * v2.2 – Számla rendezése meglévő tétellel, és beszámítás.
 *
 *  - Párosítás: egy már könyvelt (kézi) bank- / pénztár- / vegyes tétel vevő- vagy szállítósorát a számlához rendeljük.
 *    Új könyvelés nem készül, csak a rendezés kapcsolata (payments.kind = "link"); a számla így a nyitott tételek közül kikerül.
 *    Egy tétel több számlát is rendezhet, a fel nem használt része más számlához párosítható.
 *  - Beszámítás: egy számla és a vele ellentétes előjelű (helyesbítő / jóváíró) számla kölcsönös rendezése
 *    (payments.kind = "offset"). Könyvelése a partner számlán T és K ugyanazzal az összeggel.
 * Egyelőre forintos számlákra.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { assertPeriodOpen, invoiceOpenAmount, postEntry } from "./ledger";
import { round2 } from "./money";

const { invoices, journalEntries, journalLines, payments, accounts } = schema;

/** A számla vevő- / szállítósorának főkönyvi számlája (a számla könyvelési tételéből). */
async function partnerAccountOf(tx: Tx | typeof db, inv: typeof invoices.$inferSelect) {
  if (!inv.journalEntryId) throw new Error("A számla nincs könyvelve.");
  const rows = await tx
    .select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit, code: accounts.code })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, inv.journalEntryId));
  const p = rows.find((r) => /^(31|45)/.test(r.code));
  if (!p) throw new Error("A számla könyvelésében nincs vevő- / szállítósor.");
  return p.accountId;
}

/** Melyik oldalon rendezi a tétel a számlát: kiegyenlítés (pozitív nyitott) / visszatérítés (negatív nyitott). */
const settleSide = (direction: "out" | "in", sign: 1 | -1): "debit" | "credit" =>
  direction === "out" ? (sign > 0 ? "credit" : "debit") : sign > 0 ? "debit" : "credit";

export type MatchCandidate = { entryId: number; number: string; date: string; description: string; amount: number; remaining: number; partnerMatch: boolean; exact: boolean };

/** Párosítható tételek: kézi / vegyes tételek a számla partner-számláján, a megfelelő oldalon, fel nem használt összeggel. */
export async function matchCandidates(companyId: number, invoiceId: number): Promise<{ candidates: MatchCandidate[]; reason?: string }> {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  if (!inv || inv.status !== "posted") return { candidates: [], reason: "Csak könyvelt számla párosítható." };
  if (inv.currency !== "HUF") return { candidates: [], reason: "Devizás számlát a Pénzügyi rendezéssel rendezz." };
  const open = await invoiceOpenAmount(db, invoiceId);
  if (Math.abs(open.openFx) < 0.005) return { candidates: [] };
  const sign: 1 | -1 = open.openFx > 0 ? 1 : -1;
  const side = settleSide(inv.direction, sign);
  const accId = await partnerAccountOf(db, inv);
  const rows = (await db.execute(sql`
    select e.id, e.number, e.date::text as date, e.description,
      sum(case when ${side === "debit" ? sql`l.debit` : sql`l.credit`} > 0 then ${side === "debit" ? sql`l.debit` : sql`l.credit`} else 0 end)::float8 as amount,
      bool_or(l.partner_id = ${inv.partnerId}) as partner_match,
      coalesce((select sum(abs(p.partner_huf)) from payments p where p.journal_entry_id = e.id), 0)::float8 as used
    from journal_lines l join journal_entries e on e.id = l.entry_id
    where e.company_id = ${companyId} and l.account_id = ${accId}
      and (l.partner_id = ${inv.partnerId} or l.partner_id is null)
      and e.reversed_by_id is null and e.reversal_of_id is null
      and coalesce(e.source_type, '') not in ('invoice', 'payment', 'offset', 'storno')
      and ${side === "debit" ? sql`l.debit` : sql`l.credit`} > 0
    group by e.id, e.number, e.date, e.description
    order by e.date desc limit 200`)) as unknown as Array<{ id: number; number: string; date: string; description: string; amount: number; partner_match: boolean; used: number }>;
  const target = Math.abs(open.openFx);
  const candidates = rows
    .map((r) => ({ entryId: r.id, number: r.number, date: r.date, description: r.description, amount: Number(r.amount), remaining: round2(Number(r.amount) - Number(r.used)), partnerMatch: !!r.partner_match, exact: false }))
    .filter((c) => c.remaining > 0.5)
    .map((c) => ({ ...c, exact: Math.abs(c.remaining - target) < 1 }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.partnerMatch) - Number(a.partnerMatch) || Math.abs(Date.parse(a.date) - Date.parse(inv.issueDate)) - Math.abs(Date.parse(b.date) - Date.parse(inv.issueDate)))
    .slice(0, 15);
  return { candidates };
}

/** Párosítás: a számla rendezése egy meglévő tétellel (új könyvelés nélkül). */
export async function linkEntryToInvoice(companyId: number, invoiceId: number, entryId: number, amount?: number | null) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where id = ${invoiceId} for update`);
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
    if (!inv || inv.status !== "posted") throw new Error("Csak könyvelt számla párosítható.");
    if (inv.currency !== "HUF") throw new Error("Devizás számlát a Pénzügyi rendezéssel rendezz.");
    const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)));
    if (!e) throw new Error("A tétel nem található.");
    if (e.reversedById || e.reversalOfId) throw new Error("Sztornózott tétel nem párosítható.");
    if (["invoice", "payment", "offset", "storno"].includes(e.sourceType ?? "")) throw new Error("Ez a tétel számla vagy rendezés könyvelése – nem párosítható.");
    const open = await invoiceOpenAmount(tx, invoiceId);
    if (Math.abs(open.openFx) < 0.005) throw new Error("A számla már rendezve van.");
    const sign: 1 | -1 = open.openFx > 0 ? 1 : -1;
    const side = settleSide(inv.direction, sign);
    const accId = await partnerAccountOf(tx, inv);
    const lines = (await tx.select().from(journalLines).where(and(eq(journalLines.entryId, entryId), eq(journalLines.accountId, accId))))
      .filter((l) => Number(side === "debit" ? l.debit : l.credit) > 0 && (l.partnerId === inv.partnerId || l.partnerId === null));
    if (!lines.length) throw new Error(`A tételben nincs a számla partnerére szóló ${side === "debit" ? "tartozik" : "követel"} sor a vevő- / szállítószámlán.`);
    const total = lines.reduce((s, l) => s + Number(side === "debit" ? l.debit : l.credit), 0);
    const [{ used }] = await tx.select({ used: sql<number>`coalesce(sum(abs(${payments.partnerHuf})), 0)::float8` }).from(payments).where(eq(payments.journalEntryId, entryId));
    const remaining = round2(total - Number(used));
    const amt = round2(amount && amount > 0 ? amount : Math.min(remaining, Math.abs(open.openFx)));
    if (!(amt > 0)) throw new Error("A tétel teljes összege már más számlához van párosítva.");
    if (amt > remaining + 0.005) throw new Error(`A tételből csak ${remaining} Ft párosítható még.`);
    if (amt > Math.abs(open.openFx) + 0.005) throw new Error(`A számla nyitott összege ${Math.abs(open.openFx)} Ft.`);
    await assertPeriodOpen(tx, companyId, e.date);
    // a partner nélküli sorokra a számla partnere kerül (a partner-egyenleg így egyezik a nyitott tételekkel)
    const noPartner = lines.filter((l) => l.partnerId === null).map((l) => l.id);
    if (noPartner.length) await tx.update(journalLines).set({ partnerId: inv.partnerId }).where(inArray(journalLines.id, noPartner));
    const all = await tx.select({ accountId: journalLines.accountId, code: accounts.code }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).where(eq(journalLines.entryId, entryId));
    const money = all.find((l) => l.code.startsWith("38"))?.accountId ?? accId;
    const v = round2(sign * amt);
    await tx.insert(payments).values({ companyId, invoiceId, date: e.date, moneyAccountId: money, amountFx: v, fxRate: 1, amountHuf: v, partnerHuf: v, journalEntryId: entryId, kind: "link", note: `Párosítva: ${e.number}` });
    return { number: e.number, amount: amt };
  });
}

/** Beszámítható (ellentétes előjelű nyitott összegű) számlák ugyanannál a partnernél. */
export async function offsetCandidates(companyId: number, invoiceId: number) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  if (!inv || inv.status !== "posted" || inv.currency !== "HUF") return [];
  const open = await invoiceOpenAmount(db, invoiceId);
  if (Math.abs(open.openFx) < 0.005) return [];
  const others = await db.select().from(invoices).where(and(eq(invoices.companyId, companyId), eq(invoices.partnerId, inv.partnerId), eq(invoices.direction, inv.direction), eq(invoices.status, "posted"), eq(invoices.currency, "HUF"), ne(invoices.id, invoiceId)));
  const out: Array<{ id: number; number: string; date: string; open: number }> = [];
  for (const o of others) {
    const oo = await invoiceOpenAmount(db, o.id);
    if (Math.abs(oo.openFx) >= 0.005 && Math.sign(oo.openFx) !== Math.sign(open.openFx)) out.push({ id: o.id, number: o.invoiceNumber, date: o.issueDate, open: oo.openFx });
  }
  return out;
}

/** Beszámítás: két ellentétes előjelű nyitott számla kölcsönös rendezése (VN tétel a partner számlán). */
export async function offsetInvoices(companyId: number, invoiceId: number, otherId: number, date: string, amount?: number | null, userId?: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from invoices where id in (${invoiceId}, ${otherId}) for update`);
    const both = await tx.select().from(invoices).where(and(eq(invoices.companyId, companyId), inArray(invoices.id, [invoiceId, otherId])));
    const a = both.find((x) => x.id === invoiceId), b = both.find((x) => x.id === otherId);
    if (!a || !b) throw new Error("A számla nem található.");
    if (a.status !== "posted" || b.status !== "posted") throw new Error("Csak könyvelt számlák számíthatók be.");
    if (a.partnerId !== b.partnerId || a.direction !== b.direction) throw new Error("Csak azonos partner azonos irányú számlái számíthatók be.");
    if (a.currency !== "HUF" || b.currency !== "HUF") throw new Error("Beszámítás egyelőre csak forintos számláknál.");
    const oa = await invoiceOpenAmount(tx, a.id), ob = await invoiceOpenAmount(tx, b.id);
    if (Math.sign(oa.openFx) === Math.sign(ob.openFx) || !oa.openFx || !ob.openFx) throw new Error("Beszámítani csak ellentétes előjelű nyitott összegeket lehet (pl. számla és jóváíró számla).");
    const max = Math.min(Math.abs(oa.openFx), Math.abs(ob.openFx));
    const amt = round2(amount && amount > 0 ? amount : max);
    if (amt > max + 0.005) throw new Error(`Legfeljebb ${max} Ft számítható be.`);
    const pos = oa.openFx > 0 ? a : b, neg = pos === a ? b : a;
    const accId = await partnerAccountOf(tx, pos);
    const desc = `Beszámítás: ${pos.invoiceNumber} ↔ ${neg.invoiceNumber}`;
    // vevőnél: a számla követelését csökkenti (K), a jóváírást (T); szállítónál fordítva
    const posSide = pos.direction === "out" ? "credit" : "debit";
    const lines = [
      { accountId: accId, debit: posSide === "debit" ? amt : 0, credit: posSide === "credit" ? amt : 0, partnerId: pos.partnerId, description: `${desc} – ${pos.invoiceNumber}` },
      { accountId: accId, debit: posSide === "credit" ? amt : 0, credit: posSide === "debit" ? amt : 0, partnerId: pos.partnerId, description: `${desc} – ${neg.invoiceNumber}` },
    ];
    const entry = await postEntry(tx, { companyId, journalCode: "VN", date, description: desc, sourceType: "offset", sourceId: pos.id, userId, lines });
    await tx.insert(payments).values([
      { companyId, invoiceId: pos.id, date, moneyAccountId: accId, amountFx: amt, fxRate: 1, amountHuf: amt, partnerHuf: amt, journalEntryId: entry.id, kind: "offset", note: desc },
      { companyId, invoiceId: neg.id, date, moneyAccountId: accId, amountFx: -amt, fxRate: 1, amountHuf: -amt, partnerHuf: -amt, journalEntryId: entry.id, kind: "offset", note: desc },
    ]);
    return entry;
  });
}

/**
 * v3.9.6 – Automatikus párosítás: minden nyitott forintos számlához, amelyhez PONTOSAN EGY, a partnerre szóló,
 * a nyitott összeggel egyező (fel nem használt) kézi tétel tartozik, létrejön a párosítás. Kétes esetben nem nyúl hozzá.
 */
export async function autoLinkManualSettlements(companyId: number) {
  const open = (await db.execute(sql`
    select i.id, i.invoice_number from invoices i
    where i.company_id = ${companyId} and i.status = 'posted' and i.currency = 'HUF'
      and abs(i.gross_fx - coalesce((select sum(p.amount_fx) from payments p join journal_entries e on e.id = p.journal_entry_id
                                     where p.invoice_id = i.id and e.reversed_by_id is null), 0)) >= 0.005`)) as unknown as Array<{ id: number; invoice_number: string }>;
  const linked: string[] = [];
  const usedEntries = new Set<number>();
  for (const inv of open) {
    const { candidates } = await matchCandidates(companyId, inv.id);
    const exact = candidates.filter((c) => c.exact && c.partnerMatch && !usedEntries.has(c.entryId));
    if (exact.length !== 1) continue;
    const r = await linkEntryToInvoice(companyId, inv.id, exact[0].entryId);
    usedEntries.add(exact[0].entryId);
    linked.push(`${inv.invoice_number} ↔ ${r.number}`);
  }
  return linked;
}
