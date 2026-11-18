/**
 * v2.2 – Tárgyi eszközök és értékcsökkenés (ÉCS).
 *
 *  - Lineáris, napi arányosítású terv szerinti ÉCS: az aktiválás napjától a hasznos élettartam végéig.
 *    Havonta a halmozott (kerekített) érték különbsége számolódik el, így a teljes leírás pontosan a (bekerülési − maradvány) érték.
 *  - Kisértékű eszköz (≤ 200 000 Ft): aktiváláskor egy összegben (T 572 / K 1x9).
 *  - Adótörvény szerinti ÉCS: alapból egyezik a számvitelivel; eltérő éves kulcs adható (napi arányosítással, a bekerülési értékig).
 *    A kettő különbsége a TAO-alap korrekció (+ számviteli, − adótörvényi).
 *  - Könyvelés: havi ÉCS T 571 / K 1x9, havonta egy vegyes tétel (VN), eszközönkénti sorokkal. Lezárt hónapba nem könyvel.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema, type Tx, type DbOrTx } from "@/db";
import { accountIdByCode, assertPeriodOpen, inTx, postEntry } from "./ledger";
import { round2 } from "./money";
import { today } from "./dates";

const { fixedAssets, assetDepreciation, periodLocks } = schema;

import { LOW_VALUE_LIMIT, ASSET_ACCOUNTS, accDepAccount, isAssetAccount, periodOf, monthEndOf, depreciationPlan, type AssetPlanInput, type PlanRow } from "./asset-plan";
export * from "./asset-plan";
export type { AssetPlanInput, PlanRow };

// --- Adatbázis ------------------------------------------------------------------------------

export type AssetRow = typeof fixedAssets.$inferSelect & {
  posted: number; postedTax: number; accumulated: number; taxAccumulated: number; net: number; lastPeriod: string | null;
};

export async function listAssets(companyId: number, q: DbOrTx = db): Promise<AssetRow[]> {
  const [assets, deps] = await Promise.all([
    q.select().from(fixedAssets).where(eq(fixedAssets.companyId, companyId)).orderBy(asc(fixedAssets.accountCode), asc(fixedAssets.activationDate), asc(fixedAssets.id)),
    q.select().from(assetDepreciation).where(eq(assetDepreciation.companyId, companyId)),
  ]);
  return assets.map((a) => {
    const mine = deps.filter((d) => d.assetId === a.id);
    const posted = round2(mine.reduce((s, d) => s + Number(d.amount), 0));
    const postedTax = round2(mine.reduce((s, d) => s + Number(d.taxAmount), 0));
    const accumulated = round2(Number(a.openingAccumulated) + posted);
    const taxAccumulated = round2((a.taxRatePct == null ? Number(a.openingAccumulated) : Number(a.openingTaxAccumulated)) + postedTax);
    return { ...a, posted, postedTax, accumulated, taxAccumulated, net: round2(Number(a.cost) - accumulated), lastPeriod: mine.map((d) => d.period).sort().at(-1) ?? null };
  });
}

export async function getAsset(companyId: number, id: number) {
  const rows = await listAssets(companyId);
  const a = rows.find((x) => x.id === id);
  if (!a) return null;
  const deps = await db
    .select({ d: assetDepreciation, number: schema.journalEntries.number, date: schema.journalEntries.date })
    .from(assetDepreciation)
    .leftJoin(schema.journalEntries, eq(schema.journalEntries.id, assetDepreciation.journalEntryId))
    .where(and(eq(assetDepreciation.companyId, companyId), eq(assetDepreciation.assetId, id)))
    .orderBy(asc(assetDepreciation.period));
  return { asset: a, plan: depreciationPlan(planInput(a)), posted: deps };
}

const planInput = (a: typeof fixedAssets.$inferSelect): AssetPlanInput => ({
  activationDate: a.activationDate, cost: Number(a.cost), salvage: Number(a.salvage), usefulLifeMonths: a.usefulLifeMonths,
  taxRatePct: a.taxRatePct == null ? null : Number(a.taxRatePct), method: a.method, disposedOn: a.disposedOn,
  openingAccumulated: Number(a.openingAccumulated), openingTaxAccumulated: Number(a.openingTaxAccumulated),
});

/** Könyvelt, eszközszámlára (11x–14x) menő szállítói számlasorok, amelyek még nincsenek nyilvántartásba véve. */
export async function assetCandidates(companyId: number, q: DbOrTx = db) {
  const rows = (await q.execute(sql`
    select il.id, il.description, il.net_huf::float8 net, il.vat_huf::float8 vat, il.gross_huf::float8 gross,
      i.fulfillment_date::text date, i.invoice_number, i.id invoice_id, p.name partner, a.code account,
      exists (
        select 1 from journal_lines c join journal_lines w on w.entry_id = c.entry_id join accounts wa on wa.id = w.account_id
        where c.company_id = ${companyId} and c.account_id = il.account_id and c.credit = il.net_huf and wa.code like '572%' and w.debit = il.net_huf
      ) written_off
    from invoice_lines il join invoices i on i.id = il.invoice_id join partners p on p.id = i.partner_id join accounts a on a.id = il.account_id
    where i.company_id = ${companyId} and i.direction = 'in' and i.status = 'posted' and a.code ~ '^1[1-4]' and a.code !~ '^1[1-4]9' and a.code !~ '^121'
      and not exists (select 1 from fixed_assets fa where fa.invoice_line_id = il.id)
    order by i.fulfillment_date`)) as unknown as Array<{ id: number; description: string; net: number; vat: number; gross: number; date: string; invoice_number: string; invoice_id: number; partner: string; account: string; written_off: boolean }>;
  return rows.map((r) => ({ ...r, net: Number(r.net), lowValue: Number(r.net) <= LOW_VALUE_LIMIT }));
}

type NewAsset = {
  name: string; accountCode: string; activationDate: string; cost: number; salvage?: number; usefulLifeMonths?: number;
  taxRatePct?: number | null; inventoryNo?: string | null; serialNo?: string | null; location?: string | null; note?: string | null;
  openingAccumulated?: number; openingTaxAccumulated?: number; invoiceLineId?: number | null;
};

async function nextInventoryNo(tx: Tx, companyId: number) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(fixedAssets).where(eq(fixedAssets.companyId, companyId));
  return `TE-${String((r?.n ?? 0) + 1).padStart(4, "0")}`;
}

/** Kisértékű leírás könyvelése (T 572 / K 1x9) az aktiválás napjával. */
async function postLowValue(tx: Tx, companyId: number, asset: typeof fixedAssets.$inferSelect, userId?: number) {
  const amount = round2(Number(asset.cost) - Number(asset.openingAccumulated));
  if (amount <= 0) return null;
  const entry = await postEntry(tx, {
    companyId, journalCode: "VN", date: asset.activationDate, userId, sourceType: "asset", sourceId: asset.id,
    description: `Kisértékű eszköz egy összegű leírása – ${asset.name} [${asset.inventoryNo}]`,
    lines: [
      { accountId: await accountIdByCode(tx, companyId, "572"), debit: amount, credit: 0, description: asset.name },
      { accountId: await accountIdByCode(tx, companyId, accDepAccount(asset.accountCode)), debit: 0, credit: amount, description: asset.name },
    ],
  });
  await tx.insert(assetDepreciation).values({ companyId, assetId: asset.id, period: periodOf(asset.activationDate), amount, taxAmount: amount, kind: "lowvalue", journalEntryId: entry.id });
  return entry;
}

/**
 * Új eszköz nyilvántartásba vétele. 200 000 Ft-ig automatikusan kisértékű, és azonnal leíródik.
 * `alreadyWrittenOff`: a leírás korábban már könyvelve volt (pl. közvetlenül az eszközszámláról) – nem könyvel újra,
 * az eszköz leírtként / kivezetettként kerül a nyilvántartásba.
 */
export async function createAsset(companyId: number, input: NewAsset, opts: { userId?: number; alreadyWrittenOff?: boolean; tx?: Tx } = {}) {
  if (!isAssetAccount(input.accountCode)) throw new Error("Az eszközszámla 11x–14x lehet (az x9 ÉCS-számla és a 121 telek nem).");
  if (!(input.cost > 0)) throw new Error("A bekerülési érték legyen pozitív.");
  return inTx(opts.tx, async (tx) => {
    const low = input.cost <= LOW_VALUE_LIMIT;
    const def = ASSET_ACCOUNTS.find((x) => x.code === input.accountCode)?.lifeMonths ?? 60;
    const [asset] = await tx.insert(fixedAssets).values({
      companyId, name: input.name.trim(), accountCode: input.accountCode, activationDate: input.activationDate, cost: round2(input.cost),
      salvage: round2(input.salvage ?? 0), usefulLifeMonths: input.usefulLifeMonths ?? def,
      taxRatePct: input.taxRatePct == null ? null : String(input.taxRatePct), method: low ? "lowvalue" : "linear",
      status: opts.alreadyWrittenOff ? "disposed" : "active", disposedOn: opts.alreadyWrittenOff ? input.activationDate : null,
      inventoryNo: input.inventoryNo?.trim() || (await nextInventoryNo(tx, companyId)), serialNo: input.serialNo ?? null,
      location: input.location ?? null, note: opts.alreadyWrittenOff ? [input.note, "A leírás korábban, közvetlenül az eszközszámláról könyvelve."].filter(Boolean).join(" ") : input.note ?? null,
      openingAccumulated: round2(input.openingAccumulated ?? (opts.alreadyWrittenOff ? input.cost : 0)),
      openingTaxAccumulated: round2(input.openingTaxAccumulated ?? input.openingAccumulated ?? (opts.alreadyWrittenOff ? input.cost : 0)),
      invoiceLineId: input.invoiceLineId ?? null,
    }).returning();
    if (low && !opts.alreadyWrittenOff) await postLowValue(tx, companyId, asset, opts.userId);
    return asset;
  });
}

/** Könyvelt szállítói számlasorból: név, dátum, érték, számla a sorból. */
export async function registerFromLine(companyId: number, lineId: number, userId?: number, tx?: Tx) {
  const c = (await assetCandidates(companyId, tx ?? db)).find((x) => x.id === lineId);
  if (!c) throw new Error("A számlasor nem található, vagy már nyilvántartásban van.");
  return createAsset(companyId, { name: c.description.replace(/\s*–\s*tárgyi eszköz\s*$/i, ""), accountCode: c.account, activationDate: c.date, cost: c.net, invoiceLineId: c.id, note: `${c.partner} · ${c.invoice_number}` }, { userId, alreadyWrittenOff: c.written_off, tx });
}

export async function updateAsset(companyId: number, id: number, patch: Partial<Pick<typeof fixedAssets.$inferInsert, "name" | "inventoryNo" | "serialNo" | "location" | "note" | "usefulLifeMonths" | "salvage" | "taxRatePct">>) {
  await db.update(fixedAssets).set(patch).where(and(eq(fixedAssets.companyId, companyId), eq(fixedAssets.id, id)));
}

export async function deleteAsset(companyId: number, id: number) {
  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(assetDepreciation).where(and(eq(assetDepreciation.assetId, id), sql`journal_entry_id is not null`));
  const [a] = await db.select().from(fixedAssets).where(and(eq(fixedAssets.companyId, companyId), eq(fixedAssets.id, id)));
  if (!a) throw new Error("Az eszköz nem található.");
  if ((d?.n ?? 0) > 0 && a.status !== "disposed") throw new Error("Az eszközre már könyveltünk ÉCS-t – előbb stornózd a tételeket.");
  await db.delete(fixedAssets).where(and(eq(fixedAssets.companyId, companyId), eq(fixedAssets.id, id)));
}

// --- Havi ÉCS elszámolás --------------------------------------------------------------------

export type DueLine = { assetId: number; name: string; inventoryNo: string | null; accountCode: string; period: string; amount: number; taxAmount: number };
export type DuePeriod = { period: string; date: string; locked: boolean; lines: DueLine[]; total: number };

/** Az adott hónapig (bezárólag) még el nem számolt havi ÉCS, hónaponként. */
export async function depreciationDue(companyId: number, toPeriod: string, q: DbOrTx = db): Promise<DuePeriod[]> {
  const cap = toPeriod > periodOf(today()) ? periodOf(today()) : toPeriod;
  const [assets, deps, locks] = await Promise.all([
    q.select().from(fixedAssets).where(and(eq(fixedAssets.companyId, companyId), eq(fixedAssets.method, "linear"))),
    q.select({ assetId: assetDepreciation.assetId, period: assetDepreciation.period }).from(assetDepreciation).where(eq(assetDepreciation.companyId, companyId)),
    q.select().from(periodLocks).where(eq(periodLocks.companyId, companyId)),
  ]);
  const done = new Set(deps.map((d) => `${d.assetId}:${d.period}`));
  const by = new Map<string, DueLine[]>();
  for (const a of assets) {
    for (const r of depreciationPlan(planInput(a))) {
      if (r.period > cap || done.has(`${a.id}:${r.period}`) || (r.amount <= 0 && r.taxAmount <= 0)) continue;
      by.set(r.period, [...(by.get(r.period) ?? []), { assetId: a.id, name: a.name, inventoryNo: a.inventoryNo, accountCode: a.accountCode, period: r.period, amount: r.amount, taxAmount: r.taxAmount }]);
    }
  }
  return [...by.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([period, lines]) => {
    const [y, m] = period.split("-").map(Number);
    return { period, date: monthEndOf(period) > today() ? today() : monthEndOf(period), locked: locks.some((l) => l.year === y && l.month === m), lines, total: round2(lines.reduce((s, l) => s + l.amount, 0)) };
  });
}

/** Könyvelés: hónaponként egy VN tétel (T 571 / K 1x9 eszközönként). Lezárt hónapot kihagy. */
export async function postDepreciation(companyId: number, toPeriod: string, userId?: number, outerTx?: Tx) {
  const due = await depreciationDue(companyId, toPeriod, outerTx ?? db);
  const posted: Array<{ period: string; number: string; total: number }> = [];
  const skipped: string[] = [];
  for (const p of due) {
    if (p.locked) { skipped.push(p.period); continue; }
    await inTx(outerTx, async (tx) => {
      await assertPeriodOpen(tx, companyId, p.date);
      const exp = await accountIdByCode(tx, companyId, "571");
      const lines = [];
      for (const l of p.lines.filter((x) => x.amount > 0)) {
        lines.push({ accountId: exp, debit: l.amount, credit: 0, description: `${l.name} [${l.inventoryNo ?? ""}]` });
        lines.push({ accountId: await accountIdByCode(tx, companyId, accDepAccount(l.accountCode)), debit: 0, credit: l.amount, description: `${l.name} [${l.inventoryNo ?? ""}]` });
      }
      const entry = lines.length
        ? await postEntry(tx, { companyId, journalCode: "VN", date: p.date, userId, sourceType: "depreciation", description: `Terv szerinti értékcsökkenés ${p.period}`, lines })
        : null;
      await tx.insert(assetDepreciation).values(p.lines.map((l) => ({ companyId, assetId: l.assetId, period: l.period, amount: l.amount, taxAmount: l.taxAmount, kind: "linear", journalEntryId: entry?.id ?? null })));
      if (entry) posted.push({ period: p.period, number: entry.number, total: p.total });
    });
  }
  return { posted, skipped };
}

// --- Egyeztetés és eszköztükör --------------------------------------------------------------

/**
 * A nyilvántartás és a főkönyv egyeztetése: aktív eszközök bruttó értéke eszközszámlánként (11x–14x),
 * halmozott ÉCS-e a gyűjtő x9 számlánként (pl. a 141 és 143 közös 149-en).
 */
export async function reconcile(companyId: number) {
  const assets = (await listAssets(companyId)).filter((a) => a.status === "active");
  const bal = (await db.execute(sql`
    select a.code, sum(jl.debit - jl.credit)::float8 bal from journal_lines jl join accounts a on a.id = jl.account_id
    where jl.company_id = ${companyId} and a.code ~ '^1[1-4]' and a.code !~ '^121' group by a.code`)) as unknown as Array<{ code: string; bal: number }>;
  const glOf = (code: string) => round2(Number(bal.filter((b) => b.code === code).reduce((s, b) => s + Number(b.bal), 0)));
  const gross = [...new Set([...assets.map((a) => a.accountCode), ...bal.filter((b) => isAssetAccount(b.code) && Math.abs(Number(b.bal)) >= 1).map((b) => b.code)])].sort();
  const accs = [...new Set([...gross.map(accDepAccount), ...bal.filter((b) => /^1[1-4]9/.test(b.code) && Math.abs(Number(b.bal)) >= 1).map((b) => b.code)])].sort();
  const rows = [
    ...gross.map((code) => ({ kind: "gross" as const, code, reg: round2(assets.filter((a) => a.accountCode === code).reduce((s, a) => s + Number(a.cost), 0)), gl: glOf(code) })),
    ...accs.map((code) => ({ kind: "acc" as const, code, reg: round2(assets.filter((a) => accDepAccount(a.accountCode) === code).reduce((s, a) => s + a.accumulated, 0)), gl: -glOf(code) })),
  ];
  return rows.map((r) => ({ ...r, ok: Math.abs(r.reg - r.gl) < 1 }));
}

/** Eszköztükör egy üzleti évre: bruttó érték és ÉCS (nyitó, növekedés, csökkenés, záró), valamint a TAO-korrekció. */
export async function assetMirror(companyId: number, year: number) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [assets, deps] = await Promise.all([
    db.select().from(fixedAssets).where(eq(fixedAssets.companyId, companyId)),
    db.select().from(assetDepreciation).where(eq(assetDepreciation.companyId, companyId)),
  ]);
  const groups = new Map<string, { openGross: number; addGross: number; outGross: number; openAcc: number; addAcc: number; outAcc: number; tax: number }>();
  for (const a of assets) {
    // a korábban közvetlenül az eszközszámláról leírt (rögtön kivezetett) eszköz a főkönyvben sem szerepel – kihagyjuk
    if (a.status === "disposed" && a.disposedOn === a.activationDate && a.method === "lowvalue" && Number(a.openingAccumulated) >= Number(a.cost)) continue;
    const g = groups.get(a.accountCode) ?? { openGross: 0, addGross: 0, outGross: 0, openAcc: 0, addAcc: 0, outAcc: 0, tax: 0 };
    const cost = Number(a.cost);
    const before = a.activationDate < from, during = a.activationDate >= from && a.activationDate <= to;
    const out = a.disposedOn && a.disposedOn >= from && a.disposedOn <= to;
    const gone = a.disposedOn && a.disposedOn < from;
    if (gone || a.activationDate > to) continue;
    const mine = deps.filter((d) => d.assetId === a.id);
    const accBefore = Number(a.openingAccumulated) + mine.filter((d) => d.period < `${year}-01`).reduce((s, d) => s + Number(d.amount), 0);
    const accYear = mine.filter((d) => d.period.startsWith(`${year}-`)).reduce((s, d) => s + Number(d.amount), 0);
    const taxYear = mine.filter((d) => d.period.startsWith(`${year}-`)).reduce((s, d) => s + Number(d.taxAmount), 0);
    if (before) { g.openGross += cost; g.openAcc += accBefore; }
    if (during) { g.addGross += cost; g.addAcc += accBefore; }
    g.addAcc += accYear; g.tax += taxYear;
    if (out) { g.outGross += cost; g.outAcc += accBefore + accYear; }
    groups.set(a.accountCode, g);
  }
  const rows = [...groups.entries()].sort().map(([code, g]) => ({
    code, label: ASSET_ACCOUNTS.find((x) => x.code === code)?.label ?? code,
    ...g, closeGross: g.openGross + g.addGross - g.outGross, closeAcc: g.openAcc + g.addAcc - g.outAcc,
  }));
  const yearAcc = deps.filter((d) => d.period.startsWith(`${year}-`)).reduce((s, d) => s + Number(d.amount), 0);
  const yearTax = deps.filter((d) => d.period.startsWith(`${year}-`)).reduce((s, d) => s + Number(d.taxAmount), 0);
  return { year, rows, yearAcc: round2(yearAcc), yearTax: round2(yearTax), taoCorrection: round2(yearAcc - yearTax) };
}

const huFmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0, useGrouping: "always" });
const hu = (n: number) => huFmt.format(Math.round(n) || 0).replace(/\s/g, " ");

/** Eszköztükör a kiegészítő mellékletbe (szöveges táblázat, ugyanabban a formában, mint a melléklet többi táblája). */
export async function assetMirrorSection(companyId: number, year: number) {
  const m = await assetMirror(companyId, year);
  if (!m.rows.length) return null;
  const t = (k: keyof (typeof m.rows)[number]) => m.rows.reduce((s, r) => s + Number(r[k]), 0);
  const body = [
    "### Bruttó érték (Ft)",
    "| Eszközcsoport | Nyitó | Növekedés | Csökkenés | Záró |",
    "|---|---|---|---|---|",
    ...m.rows.map((r) => `| ${r.label} | ${hu(r.openGross)} | ${hu(r.addGross)} | ${hu(r.outGross)} | ${hu(r.closeGross)} |`),
    `| **Összesen** | **${hu(t("openGross"))}** | **${hu(t("addGross"))}** | **${hu(t("outGross"))}** | **${hu(t("closeGross"))}** |`,
    "",
    "### Értékcsökkenés (Ft)",
    "| Eszközcsoport | Nyitó | Növekedés | Csökkenés | Záró |",
    "|---|---|---|---|---|",
    ...m.rows.map((r) => `| ${r.label} | ${hu(r.openAcc)} | ${hu(r.addAcc)} | ${hu(r.outAcc)} | ${hu(r.closeAcc)} |`),
    `| **Összesen** | **${hu(t("openAcc"))}** | **${hu(t("addAcc"))}** | **${hu(t("outAcc"))}** | **${hu(t("closeAcc"))}** |`,
    "",
    `Az értékcsökkenés lineáris, napi arányosítással; a 200 000 Ft alatti egyedi bekerülési értékű eszközök értékcsökkenése a használatbavételkor egy összegben került elszámolásra.${m.taoCorrection ? ` A számviteli (${hu(m.yearAcc)} Ft) és az adótörvény szerinti (${hu(m.yearTax)} Ft) értékcsökkenés különbsége a társasági adóalapot ${m.taoCorrection > 0 ? "növeli" : "csökkenti"}: ${hu(Math.abs(m.taoCorrection))} Ft.` : ""}`,
  ].join("\n");
  return { no: "", title: "Tárgyi eszközök és immateriális javak (eszköztükör)", body };
}

/** Hány hónapra van még el nem számolt ÉCS (az Évzárás ellenőrzőpontjához). */
export async function depreciationStatus(companyId: number, year: number) {
  const curP = periodOf(today());
  const to = `${year}-12` < curP ? `${year}-12` : curP;
  const due = (await depreciationDue(companyId, to)).filter((p) => p.period.startsWith(`${year}-`));
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(fixedAssets).where(eq(fixedAssets.companyId, companyId));
  return { hasAssets: (n?.n ?? 0) > 0, openMonths: due.map((d) => d.period), upTo: to };
}

