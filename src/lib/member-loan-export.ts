/** Tagi kölcsön Excel (A4 fekvő): összesítő, kölcsönök (eredeti és jelenlegi lejárattal), mozgások, hosszabbítások. */
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { memberLoans } from "./member-loans";
import { normalizeTheme } from "./themes";
import { FX, HUF, d, finish, palette, sheet, totalRow, type Col } from "./invoice-export";

const KIND = { loan: "Befizetés", repayment: "Visszafizetés", reval: "Átértékelés" } as const;

export async function buildMemberLoanWorkbook(companyId: number, asOf: string) {
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  const pal = palette(normalizeTheme(company.theme).accent);
  const book = await memberLoans(companyId, asOf);
  const wb = new ExcelJS.Workbook();
  wb.creator = "MM ERP";
  const o = { company: company.name, period: `Állapot: ${asOf}`, pal };

  // 1. Összesítő
  const c1: Col[] = [
    { header: "Tag", key: "name", width: 28 }, { header: "Befizetve (Ft)", key: "received", width: 15, fmt: HUF },
    { header: "Visszafizetve (Ft)", key: "repaid", width: 15, fmt: HUF }, { header: "Átértékelés (Ft)", key: "reval", width: 14, fmt: HUF },
    { header: "Tartozás (Ft)", key: "balance", width: 15, fmt: HUF }, { header: "Ebből lejárt (Ft)", key: "overdue", width: 15, fmt: HUF },
    { header: "30 napon belül lejár (Ft)", key: "soon", width: 15, fmt: HUF }, { header: "Nyitott kölcsön (db)", key: "open", width: 11, fmt: "0" },
    { header: "Következő lejárat", key: "next", width: 13, date: true }, { header: "Deviza", key: "fx", width: 22 },
  ];
  const s1 = sheet(wb, "Összesítő", "Tagi kölcsön – összesítő", c1, o);
  for (const m of book.members) s1.addRow({ name: m.name, received: m.received, repaid: m.repaid, reval: m.revaluation, balance: m.balance, overdue: m.overdue, soon: m.dueSoon, open: m.openLoans, next: d(m.nextDue), fx: m.fx.filter((f) => Math.abs(f.balanceFx) > 0.004).map((f) => `${f.balanceFx.toLocaleString("hu-HU")} ${f.currency} (átlag ${f.avgRate})`).join("; ") });
  finish(s1, pal, c1);
  totalRow(s1, s1.addRow({ name: "Összesen", balance: book.total, overdue: book.overdue, soon: book.dueSoon, received: book.members.reduce((s, m) => s + m.received, 0), repaid: book.members.reduce((s, m) => s + m.repaid, 0), reval: book.members.reduce((s, m) => s + m.revaluation, 0) }), pal, c1.length);

  // 2. Kölcsönök
  const c2: Col[] = [
    { header: "Szerződés", key: "no", width: 13 }, { header: "Tag", key: "name", width: 24 }, { header: "Folyósítás", key: "date", width: 11, date: true },
    { header: "Összeg (Ft)", key: "amount", width: 13, fmt: HUF }, { header: "Deviza", key: "cur", width: 7 }, { header: "Devizaösszeg", key: "fx", width: 12, fmt: FX },
    { header: "Eredeti lejárat", key: "orig", width: 11, date: true }, { header: "Hosszabbítás (nap)", key: "days", width: 11, fmt: "0" },
    { header: "Jelenlegi lejárat", key: "due", width: 11, date: true }, { header: "Nyitott (Ft)", key: "open", width: 13, fmt: HUF },
    { header: "Nyitott deviza", key: "openFx", width: 12, fmt: FX }, { header: "Állapot", key: "status", width: 14 }, { header: "Napló", key: "num", width: 15 },
  ];
  const s2 = sheet(wb, "Kölcsönök", "Tagi kölcsön – szerződések", c2, o);
  for (const m of book.members) for (const r of m.rows) {
    if (r.kind !== "loan") continue;
    s2.addRow({ no: r.contractNo, name: m.name, date: d(r.date), amount: r.amount, cur: r.currency ?? "HUF", fx: r.amountFx, orig: d(r.originalDueDate), days: r.extensions.reduce((s, e) => s + e.days, 0) || null, due: d(r.dueDate), open: r.open, openFx: r.openFx, status: r.status, num: r.number });
  }
  finish(s2, pal, c2, (row) => String(row.getCell(2).value));

  // 3. Mozgások
  const c3: Col[] = [
    { header: "Dátum", key: "date", width: 11, date: true }, { header: "Tag", key: "name", width: 24 }, { header: "Típus", key: "kind", width: 13 },
    { header: "Szerződés", key: "no", width: 13 }, { header: "Összeg (Ft)", key: "amount", width: 14, fmt: HUF }, { header: "Deviza", key: "cur", width: 7 },
    { header: "Devizaösszeg", key: "fx", width: 12, fmt: FX }, { header: "Egyenleg (Ft)", key: "bal", width: 14, fmt: HUF }, { header: "Napló", key: "num", width: 15 }, { header: "Szöveg", key: "desc", width: 40 },
  ];
  const s3 = sheet(wb, "Mozgások", "Tagi kölcsön – mozgások", c3, o);
  for (const m of book.members) for (const r of m.rows) s3.addRow({ date: d(r.date), name: m.name, kind: KIND[r.kind], no: r.contractNo, amount: r.signed, cur: r.currency, fx: r.kind === "reval" ? null : r.amountFx, bal: r.balance, num: r.number, desc: r.description });
  finish(s3, pal, c3, (row) => String(row.getCell(2).value));

  // 4. Hosszabbítások
  const c4: Col[] = [
    { header: "Okiratszám", key: "doc", width: 17 }, { header: "Tag", key: "name", width: 24 }, { header: "Kelte", key: "on", width: 11, date: true },
    { header: "Eredeti lejárat", key: "orig", width: 11, date: true }, { header: "Lejárat előtte", key: "from", width: 11, date: true },
    { header: "Nap", key: "days", width: 7, fmt: "0" }, { header: "Új lejárat", key: "to", width: 11, date: true }, { header: "Megjegyzés", key: "note", width: 30 },
  ];
  const s4 = sheet(wb, "Hosszabbítások", "Tagi kölcsön – hosszabbítások", c4, o);
  for (const m of book.members) for (const r of m.rows) for (const e of r.extensions) s4.addRow({ doc: e.docNo, name: m.name, on: d(e.extendedOn), orig: d(r.originalDueDate), from: d(e.fromDue), days: e.days, to: d(e.toDue), note: e.note });
  finish(s4, pal, c4);

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), company };
}
