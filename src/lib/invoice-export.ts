/** Nyomtatható Excel a számlák ellenőrzéséhez (A4 fekvő, ismétlődő fejléc, oldalszélességre igazítva). */
import ExcelJS from "exceljs";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { invoiceAudit, type AuditInvoice } from "./invoice-audit";

const { journalEntries, journalLines, accounts, vehicles, companies } = schema;
const DIR = { in: "Szállítói", out: "Vevő" } as const;
const STATUS = { draft: "piszkozat", posted: "könyvelt", cancelled: "sztornózott" } as const;
const PAY = { transfer: "átutalás", cash: "készpénz", card: "kártya" } as Record<string, string>;
const HUF = '#,##0;[Red]-#,##0';
const FX = '#,##0.00;[Red]-#,##0.00';
const d = (s: string | null | undefined) => (s ? new Date(s + "T00:00:00Z") : null);

type Col = { header: string; key: string; width: number; fmt?: string; date?: boolean };

function sheet(wb: ExcelJS.Workbook, name: string, title: string, cols: Col[], opts: { company: string; period: string }) {
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
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : c.date ? { numFmt: "yyyy.mm.dd." } : {} }));
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A4A7A" } };
  h.alignment = { vertical: "middle", wrapText: true };
  h.height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}
const esc = (s: string) => s.replace(/&/g, "&&");

function finish(ws: ExcelJS.Worksheet, zebraKey?: (row: ExcelJS.Row) => string | number) {
  let last: string | number | undefined;
  let band = false;
  ws.eachRow((row, i) => {
    if (i === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    if (zebraKey) {
      const k = zebraKey(row);
      if (k !== last) { band = !band; last = k; }
      if (band) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F5FA" } };
    }
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = { bottom: { style: "hair", color: { argb: "FFBFC7D5" } } };
      c.font = { ...(c.font ?? {}), size: 9 };
    });
  });
}

export async function buildInvoiceWorkbook(companyId: number, opts: { from: string; to: string; dir?: "in" | "out" }) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const list = await invoiceAudit(companyId, opts);
  const meta = { company: company.name, period: `${opts.from} – ${opts.to}${opts.dir ? ` · ${DIR[opts.dir]} számlák` : ""}` };
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
    for (const f of warns) ws1.addRow({ dir: DIR[a.inv.direction], num: a.inv.invoiceNumber, partner: a.partnerName, ful: d(a.inv.fulfillmentDate), gross: Number(a.inv.grossHuf), open: a.openHuf, flag: f.text, ok: "", note: a.check.note ?? "" });
  }
  if (ws1.rowCount === 1) ws1.addRow({ flag: "Nincs figyelmeztetés az időszakban." });
  finish(ws1, (r) => String(r.getCell("num").value ?? ""));

  // 2) Számlák – minden tétel külön sor, a számla adataival
  // Nyomtatásra optimalizált oszlopok; a részletes oszlopok a végén rejtve (szűréshez, nem nyomtatódnak)
  const cols: (Col & { hidden?: boolean })[] = [
    { header: "Ir.", key: "dir", width: 4 }, { header: "Számlaszám", key: "num", width: 17 }, { header: "Partner", key: "partner", width: 22 },
    { header: "Teljesítés", key: "ful", width: 10.5, date: true }, { header: "Határidő", key: "due", width: 10.5, date: true }, { header: "Fiz.", key: "pm", width: 8 },
    { header: "Tétel", key: "desc", width: 30 }, { header: "Főkönyv", key: "acc", width: 7 }, { header: "ÁFA-kód", key: "vat", width: 7.5 },
    { header: "Gépkocsi", key: "veh", width: 17 },
    { header: "Nettó (Ft)", key: "net", width: 11, fmt: HUF }, { header: "ÁFA (Ft)", key: "vatHuf", width: 10, fmt: HUF }, { header: "Bruttó (Ft)", key: "gross", width: 11, fmt: HUF },
    { header: "Deviza", key: "fxInfo", width: 13 }, { header: "Kifizetés", key: "pays", width: 21 }, { header: "Nyitott", key: "open", width: 10, fmt: FX },
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
      const [veh, vin] = (l?.vehicle ?? "").split(" (");
      const row = ws2.addRow({
        dir: a.inv.direction === "in" ? "Sz" : "V", num: a.inv.invoiceNumber, partner: a.partnerName,
        ful: d(a.inv.fulfillmentDate), due: d(a.inv.dueDate), pm: PAY[a.inv.paymentMethod] ?? a.inv.paymentMethod,
        desc: l?.description ?? "", acc: l?.accountCode ?? "", vat: l?.vatCode ?? "", veh: veh ?? "",
        net: l?.netHuf ?? null, vatHuf: l?.vatHuf ?? null, gross: l?.grossHuf ?? null,
        fxInfo: fx && li === 0 ? `${Number(a.inv.grossFx).toLocaleString("hu-HU")} ${a.inv.currency} × ${Number(a.inv.exchangeRate).toLocaleString("hu-HU")}` : "",
        pays: li === 0 ? pays : "", open: li === 0 ? a.openFx || null : null, flags: li === 0 ? flags : "", ok: "", note: li === 0 ? a.check.note ?? "" : "",
        iss: d(a.inv.issueDate), tax: a.partnerTax ?? (a.partnerPrivate ? "magánszemély" : ""), vin: vin ? vin.replace(/\)$/, "") : "", st: STATUS[a.inv.status],
        mbase: l?.marginPurchaseHuf ?? null, invGross: Number(a.inv.grossHuf), chk, doc: a.check.docUrl ? { text: "megnyitás", hyperlink: a.check.docUrl } : "",
      });
      if (a.flags.some((f) => f.level === "warn")) row.getCell("flags").font = { color: { argb: "FFB4471A" } };
      if (a.check.docUrl) row.getCell("doc").font = { color: { argb: "FF1F5FBF" }, underline: true };
    });
  }
  finish(ws2, (r) => `${r.getCell("dir").value}|${r.getCell("num").value}|${r.getCell("partner").value}`);
  ws2.getRow(1).alignment = { vertical: "middle", wrapText: true };
  const n2 = ws2.rowCount;
  if (n2 > 1) {
    const tot = ws2.addRow({ desc: "Összesen (könyvelt + piszkozat)", net: { formula: `SUBTOTAL(9,K2:K${n2})` }, vatHuf: { formula: `SUBTOTAL(9,L2:L${n2})` }, gross: { formula: `SUBTOTAL(9,M2:M${n2})` } });
    tot.font = { bold: true };
  }

  // 3) Könyvelési tételek – számlánként a keletkezett T/K sorok
  const ids = list.map((a) => a.inv.id);
  const ws3 = sheet(wb, "Könyvelési tételek", "Könyvelési tételek számlánként", [
    { header: "Számlaszám", key: "num", width: 20 }, { header: "Partner", key: "partner", width: 26 }, { header: "Tétel", key: "entry", width: 14 },
    { header: "Dátum", key: "date", width: 11, date: true }, { header: "Napló", key: "src", width: 11 }, { header: "Szöveg", key: "desc", width: 40 },
    { header: "Számla", key: "acc", width: 9 }, { header: "Számla neve", key: "accName", width: 30 },
    { header: "Tartozik (Ft)", key: "dr", width: 14, fmt: HUF }, { header: "Követel (Ft)", key: "cr", width: 14, fmt: HUF },
    { header: "Deviza", key: "fx", width: 14, fmt: FX }, { header: "Gépkocsi", key: "veh", width: 22 }, { header: "Sztornózva", key: "rev", width: 10 },
  ], meta);
  if (ids.length) {
    const entries = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.companyId, companyId), inArray(journalEntries.sourceId, ids), or(eq(journalEntries.sourceType, "invoice"), eq(journalEntries.sourceType, "payment"), eq(journalEntries.sourceType, "storno"))))
      .orderBy(asc(journalEntries.date), asc(journalEntries.id));
    const elines = entries.length ? await db
      .select({ l: journalLines, code: accounts.code, name: accounts.name, plate: vehicles.plate, model: vehicles.model })
      .from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).leftJoin(vehicles, eq(vehicles.id, journalLines.vehicleId))
      .where(inArray(journalLines.entryId, entries.map((e) => e.id))).orderBy(asc(journalLines.entryId), asc(journalLines.id)) : [];
    const byId = new Map(list.map((a) => [a.inv.id, a]));
    const srcHu: Record<string, string> = { invoice: "számla", payment: "kiegyenlítés", storno: "sztornó" };
    for (const a of list) {
      for (const e of entries.filter((x) => x.sourceId === a.inv.id)) {
        for (const r of elines.filter((x) => x.l.entryId === e.id)) {
          ws3.addRow({ num: a.inv.invoiceNumber, partner: byId.get(a.inv.id)!.partnerName, entry: e.number, date: d(e.date), src: srcHu[e.sourceType ?? ""] ?? e.sourceType,
            desc: e.description, acc: r.code, accName: r.name, dr: Number(r.l.debit) || null, cr: Number(r.l.credit) || null,
            fx: r.l.amountFx ? Number(r.l.amountFx) : null, veh: r.plate ?? r.model ?? "", rev: e.reversedById ? "igen" : "" });
        }
      }
    }
    finish(ws3, (r) => String(r.getCell("entry").value ?? ""));
    const n3 = ws3.rowCount;
    if (n3 > 1) ws3.addRow({ desc: "Összesen", dr: { formula: `SUBTOTAL(9,I2:I${n3})` }, cr: { formula: `SUBTOTAL(9,J2:J${n3})` } }).font = { bold: true };
  }

  // 4) ÁFA-összesítő – teljesítés hónapja × irány × ÁFA-kód (könyvelt számlák)
  const ws4 = sheet(wb, "ÁFA-összesítő", "ÁFA-összesítő (teljesítés szerint)", [
    { header: "Hónap", key: "m", width: 10 }, { header: "Irány", key: "dir", width: 10 }, { header: "ÁFA-kód", key: "vat", width: 10 }, { header: "Típus", key: "kind", width: 16 },
    { header: "Számlák (db)", key: "n", width: 11 }, { header: "Nettó / adóalap (Ft)", key: "net", width: 16, fmt: HUF }, { header: "ÁFA (Ft)", key: "vatHuf", width: 14, fmt: HUF },
    { header: "Bruttó (Ft)", key: "gross", width: 16, fmt: HUF },
  ], meta);
  const agg = new Map<string, { m: string; dir: string; vat: string; kind: string; inv: Set<number>; net: number; vat_: number; gross: number }>();
  for (const a of list.filter((x) => x.inv.status === "posted")) for (const l of a.lines) {
    const k = `${a.inv.fulfillmentDate.slice(0, 7)}|${a.inv.direction}|${l.vatCode}`;
    const g = agg.get(k) ?? { m: a.inv.fulfillmentDate.slice(0, 7), dir: DIR[a.inv.direction], vat: l.vatCode, kind: KIND[l.vatKind] ?? l.vatKind, inv: new Set<number>(), net: 0, vat_: 0, gross: 0 };
    g.inv.add(a.inv.id); g.net += l.netHuf; g.vat_ += l.vatHuf; g.gross += l.grossHuf;
    agg.set(k, g);
  }
  for (const g of [...agg.values()].sort((x, y) => (x.m + x.dir + x.vat < y.m + y.dir + y.vat ? -1 : 1)))
    ws4.addRow({ m: g.m, dir: g.dir, vat: g.vat, kind: g.kind, n: g.inv.size, net: g.net, vatHuf: g.vat_, gross: g.gross });
  finish(ws4, (r) => String(r.getCell("m").value ?? ""));

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), count: list.length };
}
const KIND: Record<string, string> = {
  normal: "normál", margin: "különbözeti", exempt: "mentes", out_of_scope: "ÁFA-n kívüli", reverse_charge: "fordított", eu_acquisition: "Közösségen belüli beszerzés",
  eu_supply: "Közösségen belüli értékesítés", export: "export", non_deductible: "nem levonható",
};
