/** v7.4.0 – a PDF-kimutatások adatai (a képernyős kimutatásokkal azonos számítás). */
import { trialBalance, openItems, dailyRows } from "@/lib/reports";
import { buildPnl, buildBalanceSheet, type Statement } from "@/lib/statements";
import { renderPdfReport, type PdfRow } from "@/lib/pdf-report";
import { fmtDate, today } from "@/lib/dates";

export type PdfKind = "tb" | "pnl" | "bs" | "open";
const n = (v: number) => (Math.abs(v) < 0.5 ? "–" : Math.round(v).toLocaleString("hu-HU").replace(/ /g, " "));
const m = (v: number, cur: string) => (cur === "HUF" ? `${n(v)} Ft` : `${v.toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`.replace(/ /g, " "));

function statementRows(s: Statement): PdfRow[] {
  return s.rows.map((r) => ({
    cells: [r.label, ...r.values.map(n), ...(s.hasTotal ? [n(r.total ?? 0)] : [])],
    bold: r.kind !== "line", shade: r.kind === "total", rule: r.kind === "subtotal" || r.kind === "total", indent: r.indent,
  }));
}

export async function buildReportPdf(cid: number, company: { name: string; fiscalYearStartMonth: number }, type: PdfKind, from: string, to: string) {
  const period = `${fmtDate(from)} – ${fmtDate(to)}`;
  if (type === "tb") {
    const rows = await trialBalance(cid, from, to);
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + Number(r[k]), 0);
    const bytes = await renderPdfReport({
      title: "Főkönyvi kivonat", subtitle: `Időszak: ${period} · összegek forintban`, company: company.name, landscape: true,
      columns: [{ label: "Számla", width: 50 }, { label: "Megnevezés", width: 230 }, ...["Nyitó T", "Nyitó K", "Forgalom T", "Forgalom K", "Záró T", "Záró K"].map((l) => ({ label: l, width: 85, align: "right" as const }))],
      rows: [
        ...rows.map((r) => ({ cells: [r.code, r.name, n(r.openingDebit), n(r.openingCredit), n(r.periodDebit), n(r.periodCredit), n(r.closingDebit), n(r.closingCredit)] })),
        { cells: ["", "Összesen", n(sum("openingDebit")), n(sum("openingCredit")), n(sum("periodDebit")), n(sum("periodCredit")), n(sum("closingDebit")), n(sum("closingCredit"))], bold: true, shade: true, rule: true },
      ],
    });
    return { bytes, name: "fokonyvi-kivonat" };
  }
  if (type === "pnl" || type === "bs") {
    const daily = await dailyRows(cid, to);
    const cols = [{ key: "p", label: period, start: from, end: to }];
    // egyetlen időszak: az „Összesen” oszlop ugyanaz lenne, ezért elhagyjuk
    const s0 = type === "pnl" ? buildPnl(daily, cols) : buildBalanceSheet(daily, cols, company.fiscalYearStartMonth, from);
    const s = { ...s0, hasTotal: false };
    const labels = type === "bs" ? ["Nyitó", `Záró (${fmtDate(to)})`] : ["Összeg"];
    const bytes = await renderPdfReport({
      title: type === "pnl" ? "Eredménykimutatás" : "Mérleg", subtitle: `${type === "pnl" ? "Időszak" : "Fordulónapok"}: ${period} · összegek forintban`, company: company.name,
      columns: [{ label: "Megnevezés", width: 300 }, ...(labels ?? []).map((l) => ({ label: l, width: 110, align: "right" as const })), ...(s.hasTotal ? [{ label: "Összesen", width: 110, align: "right" as const }] : [])],
      rows: statementRows(s),
      note: type === "bs" && !s.checkOk ? "Figyelem: az eszközök és a források egyenlege eltér – lásd Egyezőség-ellenőrzés." : "Belső, tájékoztató kimutatás a könyvelés adataiból (nem a hivatalos éves beszámoló).",
    });
    return { bytes, name: type === "pnl" ? "eredmenykimutatas" : "merleg" };
  }
  const t = today();
  const [recv, pay] = await Promise.all([openItems(cid, "out"), openItems(cid, "in")]);
  const part = (title: string, rows: typeof recv): PdfRow[] => [
    { cells: [title], bold: true, shade: true },
    ...rows.map((r) => {
      const late = r.dueDate && r.dueDate < t ? Math.round((Date.parse(t) - Date.parse(r.dueDate)) / 86400000) : 0;
      return { cells: [r.invoiceNumber, r.partnerName, fmtDate(r.issueDate), fmtDate(r.dueDate), m(Number(r.grossFx), r.currency), m(Number(r.openFx), r.currency), late ? `${late} nap` : ""] };
    }),
    ...(rows.length ? [] : [{ cells: ["", "Nincs nyitott tétel."] }]),
  ];
  const bytes = await renderPdfReport({
    title: "Nyitott tételek", subtitle: `Állapot: ${fmtDate(t)}`, company: company.name, landscape: true,
    columns: [{ label: "Számla", width: 110 }, { label: "Partner", width: 220 }, { label: "Kelte", width: 70 }, { label: "Határidő", width: 70 }, { label: "Végösszeg", width: 100, align: "right" }, { label: "Nyitott", width: 100, align: "right" }, { label: "Késés", width: 60, align: "right" }],
    rows: [...part("Vevők", recv), ...part("Szállítók", pay)],
  });
  return { bytes, name: "nyitott-tetelek" };
}
