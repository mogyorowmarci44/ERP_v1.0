import "server-only";
import ExcelJS from "exceljs";
import { and, count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { manualEntry } from "@/lib/ledger";
import { cleanPartnerInput, findDuplicatePartner } from "@/lib/partner-input";
import { parseAccounts, parseCsv, parseOpening, parsePartners, type Row } from "@/lib/onboarding-calc";
import { round2 } from "@/lib/money";
import { moduleOn } from "@/lib/modules";

/**
 * v6.5.0 – Bevezetés új cégnél: Excel / CSV importok (nyitómérleg, partnerek, számlatükör), sablonok és a lépések állapota.
 */

/** Az első munkalap sorai a fejléc szerint (xlsx), vagy CSV. */
export async function readRows(file: File): Promise<Row[]> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (/\.csv$|\.txt$/i.test(file.name) || file.type === "text/csv") return parseCsv(buf.toString("utf8"));
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new Error("A fájl nem olvasható Excel (.xlsx) – mentsd el .xlsx vagy .csv formátumban.");
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  let header: string[] = [];
  const rows: Row[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const vals = (row.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v));
    if (!header.length) {
      header = vals.map((v) => String(v ?? "").trim());
      return;
    }
    void n;
    rows.push(Object.fromEntries(header.map((h, i) => [h, vals[i] ?? ""])));
  });
  return rows;
}

export type ImportReport = { ok: boolean; messages: string[] };

/** Nyitómérleg: egyetlen VN tétel a megadott napra; a hiányzó számlák (megnevezéssel) és partnerek létrejönnek. */
export async function importOpening(cid: number, rows: Row[], opts: { date: string; apply: boolean; userId: number }): Promise<ImportReport> {
  const p = parseOpening(rows);
  if (p.errors.length) return { ok: false, messages: p.errors };
  const [existing] = await db.select({ id: schema.journalEntries.id, number: schema.journalEntries.number }).from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.companyId, cid), eq(schema.journalEntries.sourceType, "opening"), sql`${schema.journalEntries.reversedById} is null`));
  if (existing) return { ok: false, messages: [`Már van nyitó tétel (${existing.number}). Ha újat töltenél be, előbb sztornózd a Naplóban.`] };
  const accs = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, cid));
  const byCode = new Map(accs.map((a) => [a.code, a]));
  const missing = [...new Map(p.items.filter((l) => !byCode.has(l.code)).map((l) => [l.code, l])).values()];
  const noName = missing.filter((l) => !l.name);
  if (noName.length) return { ok: false, messages: [`Ezek a számlák nincsenek a számlatükörben, és megnevezés sincs hozzájuk: ${noName.map((l) => l.code).join(", ")}. Add meg a „Megnevezés” oszlopot, vagy töltsd be előbb a számlatükröt.`] };
  const fxIssues = p.items.filter((l) => (byCode.get(l.code)?.currency ?? "HUF") !== "HUF" && !l.amountFx);
  if (fxIssues.length) return { ok: false, messages: [`Devizás számlánál a „Devizaösszeg” oszlop kötelező: ${fxIssues.map((l) => `${l.row}. sor (${l.code})`).join(", ")}.`] };
  const partnerNames = [...new Set(p.items.map((l) => l.partner).filter(Boolean))];
  const existingPartners = await db.select().from(schema.partners).where(eq(schema.partners.companyId, cid));
  const newPartners = partnerNames.filter((n) => !existingPartners.some((x) => x.name.toLowerCase() === n.toLowerCase()));
  const msgs = [
    `${p.items.length} tétel · Tartozik = Követel = ${p.totalDebit.toLocaleString("hu-HU")} Ft · nyitás napja: ${opts.date}.`,
    missing.length ? `Új főkönyvi számla jön létre: ${missing.map((l) => `${l.code} ${l.name}`).join(", ")}.` : "Minden számla megvan a számlatükörben.",
    newPartners.length ? `Új partner jön létre (adószám nélkül – utólag pótold): ${newPartners.join(", ")}.` : partnerNames.length ? "A partnerek megvannak." : "",
  ].filter(Boolean);
  if (!opts.apply) return { ok: true, messages: ["Ellenőrzés rendben – még semmi nem változott.", ...msgs] };
  const { accountTypeOf } = await import("@/lib/onboarding-calc");
  const entry = await db.transaction(async (tx) => {
    for (const l of missing) {
      const [a] = await tx.insert(schema.accounts).values({ companyId: cid, code: l.code, name: l.name, type: accountTypeOf(l.code), isPosting: true }).returning();
      byCode.set(a.code, a);
    }
    const pid = new Map(existingPartners.map((x) => [x.name.toLowerCase(), x.id]));
    for (const n of newPartners) {
      const [np] = await tx.insert(schema.partners).values({ companyId: cid, name: n }).returning();
      pid.set(n.toLowerCase(), np.id);
    }
    return manualEntry(cid, {
      journalCode: "VN", date: opts.date, description: "Nyitó tétel (nyitómérleg betöltése)", sourceType: "opening",
      lines: p.items.map((l) => {
        const a = byCode.get(l.code)!;
        const amt = l.debit || l.credit;
        const fx = a.currency !== "HUF" && l.amountFx ? { currency: a.currency, amountFx: l.amountFx, fxRate: round2(amt / l.amountFx) } : {};
        return { accountId: a.id, debit: l.debit, credit: l.credit, description: l.name || "Nyitó egyenleg", partnerId: l.partner ? pid.get(l.partner.toLowerCase()) ?? null : null, ...fx };
      }),
    }, opts.userId, tx);
  });
  return { ok: true, messages: [`Nyitó tétel lekönyvelve: ${entry.number}.`, ...msgs] };
}

/** Számlatükör: új számlák felvétele; meglévő kódnál a megnevezés frissül (ha eltér). */
export async function importAccounts(cid: number, rows: Row[], apply: boolean): Promise<ImportReport> {
  const p = parseAccounts(rows);
  if (p.errors.length) return { ok: false, messages: p.errors };
  const accs = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, cid));
  const byCode = new Map(accs.map((a) => [a.code, a]));
  const add = p.items.filter((x) => !byCode.has(x.code));
  const rename = p.items.filter((x) => byCode.has(x.code) && byCode.get(x.code)!.name !== x.name);
  const msgs = [`${p.items.length} sor: ${add.length} új számla, ${rename.length} megnevezés-frissítés, ${p.items.length - add.length - rename.length} változatlan.`];
  if (!apply) return { ok: true, messages: ["Ellenőrzés rendben – még semmi nem változott.", ...msgs] };
  await db.transaction(async (tx) => {
    if (add.length) await tx.insert(schema.accounts).values(add.map((x) => ({ companyId: cid, code: x.code, name: x.name, type: x.type, isPosting: x.code.length > 1 })));
    for (const x of rename) await tx.update(schema.accounts).set({ name: x.name }).where(eq(schema.accounts.id, byCode.get(x.code)!.id));
  });
  return { ok: true, messages: ["Számlatükör betöltve.", ...msgs] };
}

/** Partnerek: ellenőrzött adatokkal; a meglévő (azonos adószámú / nevű) partnert kihagyja. */
export async function importPartners(cid: number, rows: Row[], apply: boolean): Promise<ImportReport> {
  const p = parsePartners(rows);
  if (p.errors.length) return { ok: false, messages: p.errors };
  const list = await db.select().from(schema.partners).where(eq(schema.partners.companyId, cid));
  const errors: string[] = [];
  const add: ReturnType<typeof cleanPartnerInput>[] = [];
  let dup = 0;
  for (const r of p.items) {
    try {
      const c = cleanPartnerInput({ name: r.name, taxNumber: r.taxNumber, euVatNumber: r.euVatNumber, country: r.country, address: r.address, email: r.email, isPrivatePerson: r.isPrivatePerson }, { requireHuTax: false });
      if (findDuplicatePartner([...list, ...add.map((x, i) => ({ ...x, id: -i - 1 }))], c)) { dup++; continue; }
      add.push(c);
    } catch (e) {
      errors.push(`${r.row}. sor (${r.name}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors.length) return { ok: false, messages: [`${errors.length} hibás sor – javítsd, és töltsd be újra (semmi nem változott):`, ...errors.slice(0, 30)] };
  const msgs = [`${p.items.length} sor: ${add.length} új partner, ${dup} már megvan (kihagyva).`];
  if (!apply) return { ok: true, messages: ["Ellenőrzés rendben – még semmi nem változott.", ...msgs] };
  if (add.length) await db.insert(schema.partners).values(add.map((x) => ({ companyId: cid, ...x })));
  return { ok: true, messages: ["Partnerek betöltve.", ...msgs] };
}

/** Kitölthető minta-táblázat. */
export async function templateXlsx(kind: "opening" | "partners" | "accounts"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "mogyorosi.erp";
  const ws = wb.addWorksheet(kind === "opening" ? "Nyitómérleg" : kind === "partners" ? "Partnerek" : "Számlatükör");
  const T: Record<string, { cols: [string, number][]; rows: unknown[][]; note: string }> = {
    opening: {
      cols: [["Számla", 10], ["Megnevezés", 36], ["Tartozik", 16], ["Követel", 16], ["Partner", 28], ["Devizaösszeg", 14]],
      rows: [["384", "Elszámolási betétszámla", 1500000, null, null, null], ["311", "Belföldi vevők", 250000, null, "Minta Vevő Kft.", null], ["454", "Belföldi szállítók", null, 120000, "Minta Szállító Bt.", null], ["411", "Jegyzett tőke", null, 3000000, null, null], ["413", "Eredménytartalék", 1370000, null, null, null]],
      note: "Az előző könyvelő főkönyvi kivonatának záró egyenlegei. Tartozik = Követel összesen. Vevőknél / szállítóknál a Partner oszlop partnerenként bontja az egyenleget; devizás bankszámlánál a Devizaösszeg kötelező.",
    },
    partners: {
      cols: [["Név", 34], ["Adószám", 16], ["Közösségi adószám", 18], ["Ország", 8], ["Cím", 40], ["E-mail", 28], ["Magánszemély", 14]],
      rows: [["Minta Vevő Kft.", "12345676-2-41", null, "HU", "1051 Budapest, Fő u. 1.", "info@minta.hu", "nem"], ["Kiss Anna", null, null, "HU", null, null, "igen"]],
      note: "Magyar cégnél az adószám kötelező és ellenőrzött; a már meglévő partnerek kimaradnak.",
    },
    accounts: {
      cols: [["Számla", 10], ["Megnevezés", 40], ["Típus", 16]],
      rows: [["3842", "EUR devizaszámla", "eszköz"], ["5291", "Szoftver-előfizetések", "költség"]],
      note: "A Típus elhagyható (a számlaszámból adódik): eszköz, kötelezettség, saját tőke, költség, bevétel. Meglévő kódnál csak a megnevezés frissül.",
    },
  };
  const t = T[kind];
  ws.columns = t.cols.map(([h, w]) => ({ header: h, width: w }));
  ws.getRow(1).font = { bold: true };
  for (const r of t.rows) ws.addRow(r);
  const n = ws.addRow([]);
  void n;
  ws.addRow([`Megjegyzés: ${t.note} A minta sorokat töröld. – mogyorosi.erp`]).font = { italic: true, color: { argb: "FF6B7280" } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Az „Első lépések” állapota. */
export async function onboardingStatus(cid: number) {
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, cid));
  const one = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const [partners, opening, entries, members, inbox] = await Promise.all([
    one(db.select({ n: count() }).from(schema.partners).where(eq(schema.partners.companyId, cid))),
    one(db.select({ n: count() }).from(schema.journalEntries).where(and(eq(schema.journalEntries.companyId, cid), eq(schema.journalEntries.sourceType, "opening"), sql`${schema.journalEntries.reversedById} is null`))),
    one(db.select({ n: count() }).from(schema.journalEntries).where(eq(schema.journalEntries.companyId, cid))),
    one(db.select({ n: count() }).from(schema.memberships).where(eq(schema.memberships.companyId, cid))),
    db.select({ s: schema.inboxSettings.settings }).from(schema.inboxSettings).where(eq(schema.inboxSettings.companyId, cid)),
  ]);
  const bank = !!(inbox[0]?.s as { bank?: unknown } | undefined)?.bank;
  return {
    company: c,
    steps: {
      details: !!(c?.taxNumber && c?.address),
      partners: partners > 0,
      opening: opening > 0,
      bank,
      members: members > 1,
      started: entries > 0,
      inboxModule: c ? moduleOn(c, "inbox") : false,
    },
    counts: { partners, entries, members },
  };
}
