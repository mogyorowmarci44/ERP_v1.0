/** Nyomtatható Excel a számlák ellenőrzéséhez (A4 fekvő, ismétlődő fejléc, oldalszélességre igazítva). */
import ExcelJS from "exceljs";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { invoiceAudit } from "./invoice-audit";
import { normalizeTheme, inkOn } from "./themes";

const { journalEntries, journalLines, accounts, vehicles, companies } = schema;
const DIR = { in: "Szállítói", out: "Vevő" } as const;
const STATUS = { draft: "piszkozat", posted: "könyvelt", cancelled: "sztornózott" } as const;
const PAY = { transfer: "átutalás", cash: "készpénz", card: "kártya" } as Record<string, string>;
export const HUF = '#,##0;[Red]-#,##0';
export const FX = '#,##0.00;[Red]-#,##0.00';
export const d = (s: string | null | undefined) => (s ? new Date(s + "T00:00:00Z") : null);

export type Col = { header: string; key: string; width: number; fmt?: string; date?: boolean };
export type Pal = { head: string; headInk: string; band: string; total: string; rule: string };
const argb = (hex: string) => "FF" + hex.replace("#", "").toUpperCase();
/** Hex szín keverése fehérrel (t = a szín aránya). */
function tint(hex: string, t: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(255 - (255 - v) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}
export function palette(accent: string): Pal {
  return { head: accent, headInk: inkOn(accent), band: tint(accent, 0.06), total: tint(accent, 0.14), rule: tint(accent, 0.45) };
}

export function sheet(wb: ExcelJS.Workbook, name: string, title: string, cols: Col[], opts: { company: string; period: string; pal: Pal }) {
  const ws = wb.addWorksheet(name, {
    pageSetup: {
      paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
      printTitlesRow: "1:1",
    },
    headerFooter: {
      oddHeader: `&L&"-,Bold"${esc(opts.company)}&C${esc(title)}&R${esc(opts.period)}`,
      oddFooter: `&LKészült: &D &T&R&P / &N oldal`,
    },
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    properties: { tabColor: { argb: argb(opts.pal.head) } },
  });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : c.date ? { numFmt: "yyyy.mm.dd." } : {} }));
  const h = ws.getRow(1);
  h.height = 30;
  // csak a használt oszlopok fejléce színes (nem az egész sor)
  for (let i = 1; i <= cols.length; i++) {
    const c = h.getCell(i);
    c.font = { bold: true, size: 9, color: { argb: argb(opts.pal.headInk) } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(opts.pal.head) } };
    c.alignment = { vertical: "middle", wrapText: true, ...alignOf(cols[i - 1]) };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}
const esc = (s: string) => s.replace(/&/g, "&&");

/** Oszloptípus szerinti igazítás: szám jobbra, dátum középre, szöveg balra kis behúzással (hogy ne tapadjon a szomszéd számhoz). */
function alignOf(c: Col): Partial<ExcelJS.Alignment> {
  if (c.fmt) return { horizontal: "right" };
  if (c.date) return { horizontal: "center" };
  return { horizontal: "left", indent: 1 };
}
export function finish(ws: ExcelJS.Worksheet, pal: Pal, cols: Col[], zebraKey?: (row: ExcelJS.Row) => string | number) {
  const ncols = cols.length;
  let last: string | number | undefined;
  let band = false;
  ws.eachRow((row, i) => {
    if (i === 1) return;
    let fill = false;
    if (zebraKey) {
      const k = zebraKey(row);
      if (k !== last) { band = !band; last = k; }
      fill = band;
    }
    for (let c = 1; c <= ncols; c++) {
      const cell = row.getCell(c);
      cell.alignment = { vertical: "top", wrapText: true, ...alignOf(cols[c - 1]) };
      cell.font = { ...(cell.font ?? {}), size: 9 };
      if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(pal.band) } };
    }
  });
}
/** Összesítő sor: halvány témaszínű háttér, vastag betű, vékony témaszínű vonal felül – csak a használt oszlopokon. */
export function totalRow(ws: ExcelJS.Worksheet, row: ExcelJS.Row, pal: Pal, ncols: number) {
  for (let c = 1; c <= ncols; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(pal.total) } };
    cell.border = { top: { style: "thin", color: { argb: argb(pal.rule) } } };
  }
}

export async function buildInvoiceWorkbook(companyId: number, opts: { from: string; to: string; dir?: "in" | "out" }) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const list = await invoiceAudit(companyId, opts);
  const pal = palette(normalizeTheme(company.theme).accent);
  const meta = { company: company.name, period: `${opts.from} – ${opts.to}${opts.dir ? ` · ${DIR[opts.dir]} számlák` : ""}`, pal };
  const wb = new ExcelJS.Workbook();
  wb.creator = "MM ERP";
  wb.created = new Date();

  // 1) Eltérések – csak a figyelmeztetéssel jelzett számlák
  const flagCols: Col[] = [
    { header: "Irány", key: "dir", width: 9 }, { header: "Számlaszám", key: "num", width: 20 }, { header: "Partner", key: "partner", width: 28 },
    { header: "Teljesítés", key: "ful", width: 12, date: true }, { header: "Bruttó (Ft)", key: "gross", width: 14, fmt: HUF }, { header: "Nyitott (Ft)", key: "open", width: 13, fmt: HUF },
    { header: "Jelzés", key: "flag", width: 70 }, { header: "✓", key: "ok", width: 5 }, { header: "Megjegyzés", key: "note", width: 30 },
  ];
  const ws1 = sheet(wb, "Eltérések", "Eltérések – ellenőrizendő számlák", flagCols, meta);
  for (const a of list) {
    const warns = a.flags.filter((f) => f.level === "warn");
    for (const f of warns) ws1.addRow({ dir: DIR[a.inv.direction], num: a.inv.invoiceNumber, partner: a.partnerName, ful: d(a.inv.fulfillmentDate), gross: Number(a.inv.grossHuf), open: Math.round(a.openHuf) || null, flag: f.text, ok: "", note: a.check.note ?? "" });
  }
  if (ws1.rowCount === 1) ws1.addRow({ flag: "Nincs figyelmeztetés az időszakban." });
  finish(ws1, pal, flagCols, (r) => String(r.getCell("num").value ?? ""));

  // 2) Számlák – minden tétel külön sor, a számla adataival
  // Nyomtatásra optimalizált oszlopok; a részletes oszlopok a végén rejtve (szűréshez, nem nyomtatódnak)
  const cols: (Col & { hidden?: boolean })[] = [
    { header: "Ir.", key: "dir", width: 4 }, { header: "Számlaszám", key: "num", width: 17 }, { header: "Partner", key: "partner", width: 22 },
    { header: "Teljesítés", key: "ful", width: 10.5, date: true }, { header: "Határidő", key: "due", width: 10.5, date: true }, { header: "Fiz.", key: "pm", width: 8 },
    { header: "Tétel", key: "desc", width: 30 }, { header: "Főkönyv", key: "acc", width: 7 }, { header: "ÁFA-kód", key: "vat", width: 7.5 },
    { header: "Gépkocsi", key: "veh", width: 17 },
    { header: "Nettó (Ft)", key: "net", width: 11, fmt: HUF }, { header: "ÁFA (Ft)", key: "vatHuf", width: 10, fmt: HUF }, { header: "Bruttó (Ft)", key: "gross", width: 11, fmt: HUF },
    { header: "Deviza", key: "fxInfo", width: 13 }, { header: "Kifizetés", key: "pays", width: 21 }, { header: "Nyitott (Ft)", key: "open", width: 10.5, fmt: HUF },
    { header: "Jelzések", key: "flags", width: 30 }, { header: "✓", key: "ok", width: 4 }, { header: "Megjegyzés", key: "note", width: 18 },
    // rejtett részletek
    { header: "Kelte", key: "iss", width: 11, date: true, hidden: true }, { header: "Adószám", key: "tax", width: 14, hidden: true },
    { header: "Alvázszám", key: "vin", width: 19, hidden: true }, { header: "Állapot", key: "st", width: 10, hidden: true },
    { header: "Különb. beszerzési ár (Ft)", key: "mbase", width: 14, fmt: HUF, hidden: true }, { header: "Számla bruttó (Ft)", key: "invGross", width: 13, fmt: HUF, hidden: true },
    { header: "Ellenőrizve (ERP)", key: "chk", width: 16, hidden: true }, { header: "Bizonylat", key: "doc", width: 18, hidden: true },
  ];
  const ws2 = sheet(wb, "Számlák", "Számlák tételsoronként", cols, meta);
  cols.forEach((c, i) => { if (c.hidden) ws2.getColumn(i + 1).hidden = true; });
  for (const a of list) {
    const fx = a.inv.currency !== "HUF";
    const pays = a.payments.filter((p) => !p.reversed).map((p) => `${p.date.slice(5).replace("-", ".")}. ${p.accountCode} ${Math.round(p.amountHuf).toLocaleString("hu-HU")}`).join("\n");
    const flags = a.flags.map((f) => (f.level === "warn" ? "⚠ " : "") + f.text).join("\n");
    const chk = a.check.checked ? `✓ ${a.check.by ?? ""} ${a.check.at ? a.check.at.toISOString().slice(0, 10) : ""}` : a.check.stale ? "módosult" : "";
    const lines = a.lines.length ? a.lines : [null];
    lines.forEach((l, li) => {
      const veh = l?.vehicle ?? "";
      const vin = l?.vehicleVin ?? "";
      const row = ws2.addRow({
        dir: a.inv.direction === "in" ? "Sz" : "V", num: a.inv.invoiceNumber, partner: a.partnerName,
        ful: d(a.inv.fulfillmentDate), due: d(a.inv.dueDate), pm: PAY[a.inv.paymentMethod] ?? a.inv.paymentMethod,
        desc: l?.description ?? "", acc: l?.accountCode ?? "", vat: l?.vatCode ?? "", veh: veh ?? "",
        net: l?.netHuf ?? null, vatHuf: l?.vatHuf ?? null, gross: l?.grossHuf ?? null,
        fxInfo: fx && li === 0 ? `${Number(a.inv.grossFx).toLocaleString("hu-HU")} ${a.inv.currency} × ${Number(a.inv.exchangeRate).toLocaleString("hu-HU")}` : "",
        pays: li === 0 ? pays : "", open: li === 0 ? (Math.round(a.openHuf) || null) : null, flags: li === 0 ? flags : "", ok: "", note: li === 0 ? a.check.note ?? "" : "",
        iss: d(a.inv.issueDate), tax: a.partnerTax ?? (a.partnerPrivate ? "magánszemély" : ""), vin, st: STATUS[a.inv.status],
        mbase: l?.marginPurchaseHuf ?? null, invGross: Number(a.inv.grossHuf), chk, doc: a.check.docUrl ? { text: "megnyitás", hyperlink: a.check.docUrl } : "",
      });
      if (a.flags.some((f) => f.level === "warn")) row.getCell("flags").font = { color: { argb: "FFB4471A" } };
      if (a.check.docUrl) row.getCell("doc").font = { color: { argb: argb(pal.head) }, underline: true };
    });
  }
  const printCols = cols.filter((c) => !c.hidden).length;
  finish(ws2, pal, cols, (r) => `${r.getCell("dir").value}|${r.getCell("num").value}|${r.getCell("partner").value}`);
  ws2.getRow(1).alignment = { vertical: "middle", wrapText: true };
  const n2 = ws2.rowCount;
  if (n2 > 1) {
    const tot = ws2.addRow({ desc: "Összesen (könyvelt + piszkozat)", net: { formula: `SUBTOTAL(9,K2:K${n2})` }, vatHuf: { formula: `SUBTOTAL(9,L2:L${n2})` }, gross: { formula: `SUBTOTAL(9,M2:M${n2})` } });
    totalRow(ws2, tot, pal, printCols);
  }

  // 3) Könyvelési tételek – számlánként a keletkezett T/K sorok
  const ids = list.map((a) => a.inv.id);
  const jCols: Col[] = [
    { header: "Számlaszám", key: "num", width: 20 }, { header: "Partner", key: "partner", width: 26 }, { header: "Tétel", key: "entry", width: 14 },
    { header: "Dátum", key: "date", width: 11, date: true }, { header: "Napló", key: "src", width: 11 }, { header: "Szöveg", key: "desc", width: 40 },
    { header: "Számla", key: "acc", width: 9 }, { header: "Számla neve", key: "accName", width: 30 },
    { header: "Tartozik (Ft)", key: "dr", width: 14, fmt: HUF }, { header: "Követel (Ft)", key: "cr", width: 14, fmt: HUF },
    { header: "Deviza", key: "fx", width: 14, fmt: FX }, { header: "Gépkocsi", key: "veh", width: 22 }, { header: "Sztornózva", key: "rev", width: 10 },
  ];
  const ws3 = sheet(wb, "Könyvelési tételek", "Könyvelési tételek számlánként", jCols, meta);
  if (ids.length) {
    const entries = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.companyId, companyId), inArray(journalEntries.sourceId, ids), or(eq(journalEntries.sourceType, "invoice"), eq(journalEntries.sourceType, "payment"), eq(journalEntries.sourceType, "storno"))))
      .orderBy(asc(journalEntries.date), asc(journalEntries.id));
    const elines = entries.length ? await db
      .select({ l: journalLines, code: accounts.code, name: accounts.name, plate: vehicles.plate, vin: vehicles.vin, model: vehicles.model })
      .from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).leftJoin(vehicles, eq(vehicles.id, journalLines.vehicleId))
      .where(inArray(journalLines.entryId, entries.map((e) => e.id))).orderBy(asc(journalLines.entryId), asc(journalLines.id)) : [];
    const byId = new Map(list.map((a) => [a.inv.id, a]));
    const srcHu: Record<string, string> = { invoice: "számla", payment: "kiegyenlítés", storno: "sztornó" };
    for (const a of list) {
      for (const e of entries.filter((x) => x.sourceId === a.inv.id)) {
        for (const r of elines.filter((x) => x.l.entryId === e.id)) {
          ws3.addRow({ num: a.inv.invoiceNumber, partner: byId.get(a.inv.id)!.partnerName, entry: e.number, date: d(e.date), src: srcHu[e.sourceType ?? ""] ?? e.sourceType,
            desc: e.description, acc: r.code, accName: r.name, dr: Number(r.l.debit) || null, cr: Number(r.l.credit) || null,
            fx: r.l.amountFx ? Number(r.l.amountFx) : null, veh: r.plate || r.vin || r.model || "", rev: e.reversedById ? "igen" : "" });
        }
      }
    }
    finish(ws3, pal, jCols, (r) => String(r.getCell("entry").value ?? ""));
    const n3 = ws3.rowCount;
    if (n3 > 1) totalRow(ws3, ws3.addRow({ desc: "Összesen", dr: { formula: `SUBTOTAL(9,I2:I${n3})` }, cr: { formula: `SUBTOTAL(9,J2:J${n3})` } }), pal, 13);
  }

  // 4) ÁFA-összesítő – teljesítés hónapja × irány × ÁFA-kód (könyvelt számlák)
  const vatCols: Col[] = [
    { header: "Hónap", key: "m", width: 10 }, { header: "Irány", key: "dir", width: 10 }, { header: "ÁFA-kód", key: "vat", width: 10 }, { header: "Típus", key: "kind", width: 16 },
    { header: "Számlák (db)", key: "n", width: 11, fmt: "0" }, { header: "Nettó / adóalap (Ft)", key: "net", width: 16, fmt: HUF }, { header: "ÁFA (Ft)", key: "vatHuf", width: 14, fmt: HUF },
    { header: "Bruttó (Ft)", key: "gross", width: 16, fmt: HUF },
  ];
  const ws4 = sheet(wb, "ÁFA-összesítő", "ÁFA-összesítő (teljesítés szerint)", vatCols, meta);
  const agg = new Map<string, { m: string; dir: string; vat: string; kind: string; inv: Set<number>; net: number; vat_: number; gross: number }>();
  for (const a of list.filter((x) => x.inv.status === "posted")) for (const l of a.lines) {
    const k = `${a.inv.fulfillmentDate.slice(0, 7)}|${a.inv.direction}|${l.vatCode}`;
    const g = agg.get(k) ?? { m: a.inv.fulfillmentDate.slice(0, 7), dir: DIR[a.inv.direction], vat: l.vatCode, kind: KIND[l.vatKind] ?? l.vatKind, inv: new Set<number>(), net: 0, vat_: 0, gross: 0 };
    g.inv.add(a.inv.id); g.net += l.netHuf; g.vat_ += l.vatHuf; g.gross += l.grossHuf;
    agg.set(k, g);
  }
  for (const g of [...agg.values()].sort((x, y) => (x.m + x.dir + x.vat < y.m + y.dir + y.vat ? -1 : 1)))
    ws4.addRow({ m: g.m, dir: g.dir, vat: g.vat, kind: g.kind, n: g.inv.size, net: g.net, vatHuf: g.vat_, gross: g.gross });
  finish(ws4, pal, vatCols, (r) => String(r.getCell("m").value ?? ""));

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), count: list.length };
}
const KIND: Record<string, string> = {
  normal: "normál", margin: "különbözeti", exempt: "mentes", out_of_scope: "ÁFA-n kívüli", reverse_charge: "fordított", eu_acquisition: "Közösségen belüli beszerzés",
  eu_supply: "Közösségen belüli értékesítés", export: "export", non_deductible: "nem levonható",
};
