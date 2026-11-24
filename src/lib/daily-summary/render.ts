/**
 * v3.9.2 / v3.9.4 – Napi összefoglaló e-mail, „napilap” stílusban (a cég neve a fejlécben).
 * Cégszintű változatok: ügyvezető (számok, eredmény, határidők, teendők, autók), pénzügyes (… + tegnapi egyéb történések, CSV),
 * teljes (mind). A holding e-mail ugyanebben a stílusban, minden cég egyben.
 * E-mail-biztos: táblázatos elrendezés, inline stílusok, kép és JS nélkül.
 */
import type { CompanySnapshot, HoldingSnapshot, Level } from "./data";
import { money, mFt2, eFt1, ft0 } from "./format";
import { APP_VERSION } from "@/lib/version";

export { money };
export type Variant = "ceo" | "cfo" | "full";
export const VARIANT_LABEL: Record<Variant, string> = {
  ceo: "Ügyvezető – számok, eredmény, határidők, teendők, autók",
  cfo: "Pénzügyes – számok, eredmény, határidők, teendők, tegnapi történések",
  full: "Teljes – minden blokk",
};
export type Mail = { subject: string; html: string; text: string };

const HU_DAY = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
export const dayLabel = (d: string, withDow = true) =>
  `${d.slice(0, 4)}. ${HU_M[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}.${withDow ? `, ${HU_DAY[new Date(d + "T00:00:00Z").getUTCDay()]}` : ""}`;
export function appUrl(): string {
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
}

const BLOCKS: Record<Variant, { cars: boolean; finance: boolean }> = { ceo: { cars: true, finance: false }, cfo: { cars: false, finance: true }, full: { cars: true, finance: true } };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const HU_M = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
const shortD = (d: string) => `${HU_M[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}.`;
const qLabel = (d: string) => `${["I.", "II.", "III.", "IV."][Math.floor((Number(d.slice(5, 7)) - 1) / 3)]} negyedév`;
const pct = (a: number, b: number | null) => (b && b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : null);
const href = (path: string) => (appUrl() ? appUrl() + path : "");
const A = (path: string, inner: string, color: string) => {
  const h = href(path);
  return h ? `<a href="${esc(h)}" style="color:${color};text-decoration:none">${inner}</a>` : inner;
};
const SANS = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const SERIF = "font-family:Georgia,'Times New Roman',Times,serif;";
const MONO = "font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;";

function shell(bg: string, preheader: string, inner: string) {
  return `<!DOCTYPE html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(preheader)}</title></head>
<body style="margin:0;padding:0;background:${bg}"><div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${bg}"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px">${inner}</table>
</td></tr></table></body></html>`;
}
const subject = (s: CompanySnapshot) => {
  const open = s.todos.filter((t) => t.level !== "green").length;
  return `${s.name} – napi összefoglaló, ${shortD(s.date)}${open ? ` · ${open} teendő` : " · minden rendben"}`;
};
const openTodos = (s: CompanySnapshot) => s.todos.filter((t) => t.level !== "green");


// --- cégszintű e-mail ---------------------------------------------------------
// --- napilap stílus: színek és építőkockák ------------------------------------
const K = { bg: "#efe9dd", paper: "#fbf8f1", ink: "#1b1a17", mute: "#6b655a", rule: "#1b1a17", hair: "#d9d1c1", accent: "#0f5a43", red: "#a3261c", yellow: "#9a6a00", green: "#0f5a43" };
const LV: Record<Level, string> = { red: K.red, yellow: K.yellow, green: K.green };
const kick = (t: string) => `<div style="${SANS}font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:${K.accent};font-weight:700">${esc(t)}</div>`;
const head = (t: string, right = "") => `<tr><td style="padding:26px 0 10px;border-top:3px double ${K.rule}"><table role="presentation" width="100%"><tr><td style="${SERIF}font-size:22px;font-style:italic;color:${K.ink}">${esc(t)}</td><td align="right" style="${SANS}font-size:11px;color:${K.mute}">${right}</td></tr></table></td></tr>`;
const figure = (lbl: string, val: string, note = "", color = K.ink, size = 26) => `<div style="${SANS}font-size:11px;color:${K.mute};text-transform:uppercase;letter-spacing:.08em">${esc(lbl)}</div>
  <div style="${SERIF}font-size:${size}px;color:${color};line-height:1.15;padding-top:4px;white-space:nowrap">${val}</div>${note ? `<div style="${SANS}font-size:11.5px;color:${K.mute};padding-top:2px">${note}</div>` : ""}`;
const vrule = (cells: string[]) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${cells.map((c, i) => `<td valign="top" width="${Math.floor(100 / cells.length)}%" style="padding:0 ${i < cells.length - 1 ? 14 : 0}px 0 ${i ? 14 : 0}px;${i ? `border-left:1px solid ${K.hair};` : ""}">${c}</td>`).join("")}</tr></table>`;
/** v3.9.5 – előjel szerinti szín: pozitív zöld, nulla sárga, negatív piros. */
const SIGN = { pos: "#1e7a46", zero: "#b07d00", neg: "#b3261e" };
const sign = (n: number) => (Math.abs(n) < 0.5 ? SIGN.zero : n > 0 ? SIGN.pos : SIGN.neg);

function companyHtml(s: CompanySnapshot, v: Variant): string {
  const b = BLOCKS[v];
  const rows: string[] = [];

  // impresszum / fejléc
  rows.push(`<tr><td style="padding:0 0 6px;border-bottom:1px solid ${K.rule}"><table role="presentation" width="100%"><tr>
    <td style="${SANS}font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:${K.mute}">${esc(dayLabel(s.date))}</td>
    <td align="right" style="${SANS}font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:${K.mute}">${v === "ceo" ? "Ügyvezetői" : v === "cfo" ? "Pénzügyi" : "Teljes"} összefoglaló</td></tr></table></td></tr>`);
  rows.push(`<tr><td align="center" style="padding:14px 0 4px;${SERIF}font-size:${s.name.length > 18 ? 36 : 44}px;font-weight:700;color:${K.ink};letter-spacing:-.01em;line-height:1.05">${esc(s.name)}</td></tr>`);
  rows.push(`<tr><td align="center" style="padding:2px 0 12px;border-bottom:3px double ${K.rule};${SANS}font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${K.accent}">Napi összefoglaló · mogyorosi.erp</td></tr>`);
  // vezércikk
  rows.push(`<tr><td style="padding:22px 0 18px">${kick("Összefoglaló")}
    <div style="${SERIF}font-size:27px;line-height:1.25;color:${K.ink};padding-top:8px">${esc(s.headline)}</div></td></tr>`);
  const sv = s.stockValue;
  // v3.9.10 – „C” elrendezés: kiemelt összes pénz + pénztár/bank arány-csík, alatta 2 × 2 szimmetrikus rács, középre zárva
  const liq = s.kpi.liquidity;
  const bank = s.kpi.bank;
  const till = liq - bank;
  const share = (x: number) => (liq > 0.5 && x > 0 ? Math.round((x / liq) * 100) : 0);
  const tillPct = share(till);
  const bankPct = till > 0 && bank > 0 ? 100 - tillPct : share(bank);
  const bar = tillPct + bankPct > 0
    ? `<table role="presentation" width="300" align="center" cellspacing="0" cellpadding="0" style="margin:9px auto 4px;width:300px;max-width:80%"><tr>${tillPct ? `<td width="${tillPct}%" height="6" style="height:6px;line-height:6px;font-size:0;background:${K.accent}">&nbsp;</td>` : ""}${bankPct ? `<td width="${bankPct}%" height="6" style="height:6px;line-height:6px;font-size:0;background:${K.hair}">&nbsp;</td>` : ""}</tr></table>`
    : "";
  rows.push(`<tr><td align="center" style="padding:18px 0 14px;border-top:1px solid ${K.hair};text-align:center">
    <div style="${SANS}font-size:11px;color:${K.accent};text-transform:uppercase;letter-spacing:.08em;font-weight:700">Összes pénz</div>
    <div style="${SERIF}font-size:36px;font-weight:700;color:${K.ink};line-height:1.15;padding-top:3px;white-space:nowrap">${eFt1(liq)}</div>
    ${bar}<div style="${SANS}font-size:12px;font-weight:300;color:${K.mute}">pénztár + bank, mai árfolyamon</div></td></tr>`);
  const pct0 = (p: number) => (liq > 0.5 ? `${p}% · ` : "");
  const tillNote = pct0(tillPct) + (Math.abs(till - s.kpi.cashHuf) > 0.5 ? `ebből Ft-pénztár ${money(s.kpi.cashHuf)}` : "forintpénztár");
  const bankNote = pct0(bankPct) + "mai árfolyamon";
  const sq = (lbl: string, val: string, note: string) => `<div style="text-align:center"><div style="${SANS}font-size:11px;color:${K.accent};text-transform:uppercase;letter-spacing:.08em;font-weight:700">${esc(lbl)}</div>
      <div style="${SERIF}font-size:24px;font-weight:700;color:${K.ink};line-height:1.15;padding-top:3px;white-space:nowrap">${val}</div>
      <div style="${SANS}font-size:12px;font-weight:300;color:${K.mute};padding-top:3px">${note || "&nbsp;"}</div></div>`;
  rows.push(`<tr><td style="padding:12px 0;border-top:1px dotted ${K.hair}">${vrule([
    sq("Pénztár", eFt1(till), tillNote),
    sq("Bankszámla", eFt1(bank), bankNote),
  ])}</td></tr>`);
  const stockCell = sv ? sq("Készlet értéke", mFt2(sv.value), `beszerzési ár: ${mFt2(sv.purchase)}`) : sq("Eladó autó", `${s.kpi.stock ?? "–"} db`, "");
  rows.push(`<tr><td style="padding:12px 0 16px;border-top:1px dotted ${K.hair};border-bottom:1px solid ${K.hair}">${vrule([
    sq("Tegnapi bevétel", ft0(s.kpi.revenueDay), `${shortD(s.day)} · előző 30 nap: ${money(s.kpi.revenue30)}`),
    stockCell,
  ])}</td></tr>`);
  rows.push(`<tr><td style="padding:10px 0 0;${SANS}font-size:12.5px;color:${K.mute}">Eladó autó: <b style="color:${K.ink}">${s.kpi.stock ?? "–"} db</b> &nbsp;·&nbsp; Lejárt vevői tartozás: <b style="color:${s.kpi.lateReceivableCount ? K.red : K.ink}">${s.kpi.lateReceivableCount ? money(s.kpi.lateReceivable) : "nincs"}</b> &nbsp;·&nbsp; Lejárt szállítói tartozás: <b style="color:${s.kpi.latePayableCount ? K.red : K.ink}">${s.kpi.latePayableCount ? money(s.kpi.latePayable) : "nincs"}</b></td></tr>`);

  // eredmény-rovat
  const r = s.results;
  const p = pct(r.year, r.yearForecast);
  rows.push(head("Eredmény", "adózás előtt"));
  const line = (t: string, n: number | null, strong = false, note = "") => `<tr>
    <td style="${SERIF}font-size:${strong ? 19 : 16}px;color:${K.ink};padding:9px 0;border-bottom:1px dotted ${K.hair};${strong ? "font-weight:700;" : ""}">${esc(t)}${note ? `<span style="${SANS}font-size:11.5px;color:${K.mute};font-weight:400"> · ${note}</span>` : ""}</td>
    <td align="right" style="${SERIF}font-size:${strong ? 21 : 17}px;color:${n == null ? K.mute : sign(n)};padding:9px 0;border-bottom:1px dotted ${K.hair};white-space:nowrap;${strong ? "font-weight:700;" : ""}">${n == null ? "nincs Forecast" : money(n, true)}</td></tr>`;
  rows.push(`<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    ${line("Ebben a hónapban", r.month)}
    ${line("Ebben a negyedévben", r.quarter)}
    ${line("Idén eddig", r.year)}
    ${line(`Várható éves eredmény (${s.date.slice(0, 4)})`, r.yearForecast, true, "Forecast szerint")}
  </table>
  ${p != null ? `<div style="${SANS}font-size:12px;color:${K.mute};padding-top:10px">Az idei várt eredmény <b style="color:${K.ink}">${p}%-a</b> már megvan${r.yearForecastAfterTax != null ? `, adózás után várhatóan ${money(r.yearForecastAfterTax, true)} marad` : ""}.</div>
    <div style="height:4px;background:${K.hair};margin-top:8px"><div style="height:4px;width:${p}%;background:${K.accent}"></div></div>` : ""}</td></tr>`);

  // két hasáb: teendők | naptár
  const td = openTodos(s);
  const todoCol = `${kick("Teendők")}<div style="${SERIF}font-size:19px;font-style:italic;color:${K.ink};padding:6px 0 4px">${td.length ? `${td.length === 1 ? "Egy" : td.length === 2 ? "Két" : td.length} dolog vár rád` : "Nincs teendő"}</div>
    ${td.length ? td.map((t) => `<div style="${SANS}font-size:13.5px;line-height:1.45;color:${K.ink};padding:7px 0;border-top:1px solid ${K.hair}"><span style="color:${LV[t.level]};font-weight:700">${t.level === "red" ? "■" : "□"}</span>&nbsp; ${A(t.path, esc(t.text), K.ink)}</div>`).join("")
      : `<div style="${SANS}font-size:13.5px;color:${K.green}">Minden rendben, ma nincs mit intézni.</div>`}`;
  const cal = (t: string, d: { date: string; days: number } | null) => `<div style="border:1px solid ${K.ink};margin-top:10px">
    <div style="background:${K.ink};${SANS}font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:${K.paper};padding:4px 8px">${esc(t)}</div>
    ${d ? `<table role="presentation" width="100%"><tr><td style="${SERIF}font-size:34px;font-weight:700;color:${d.days <= 5 ? K.red : K.ink};padding:6px 10px;line-height:1">${Number(d.date.slice(8, 10))}</td>
      <td style="${SANS}font-size:11.5px;color:${K.mute};padding:6px 10px 6px 0" align="right">${HU_M[Number(d.date.slice(5, 7)) - 1]}<br><b style="color:${d.days <= 5 ? K.red : K.ink}">${d.days === 0 ? "ma" : d.days === 1 ? "holnap" : `${d.days} nap múlva`}</b></td></tr></table>`
      : `<div style="${SANS}font-size:12px;color:${K.mute};padding:8px 10px">nem kell beadni</div>`}</div>`;
  const calCol = `${kick("Határidők")}${cal("ÁFA-bevallás", s.deadlines.vat)}${cal("Járulékbevallás", s.deadlines.payroll)}`;
  rows.push(`<tr><td style="padding:26px 0 0;border-top:3px double ${K.rule}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
    <td valign="top" width="64%" style="padding-right:16px">${todoCol}</td><td valign="top" width="36%" style="padding-left:16px;border-left:1px solid ${K.hair}">${calCol}</td></tr></table></td></tr>`);

  // autók
  if (b.cars && s.cars) {
    const c = s.cars;
    rows.push(head("Autók", "KészletMérleg szerint"));
    rows.push(`<tr><td style="padding-bottom:6px">${vrule([
      figure("Legutóbbi eladás", c.daysSinceSale != null ? (c.daysSinceSale === 0 ? "ma" : c.daysSinceSale === 1 ? "tegnap" : `${c.daysSinceSale} napja`) : "–"),
      figure("Autókban álló pénz", money(c.capital)),
      figure("Átlagosan áll", c.avgDays != null ? `${c.avgDays} napja` : "–"),
    ])}</td></tr>`);
    if (c.soldDay.length) rows.push(`<tr><td style="${SERIF}font-size:15px;font-style:italic;color:${K.accent};padding:10px 0">Tegnap eladtuk: ${c.soldDay.map((x) => `${esc(x.title)}, ${money(x.f2, true)} nettó fedezettel`).join("; ")}.</td></tr>`);
    rows.push(`<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${c.top.map((x) => `<tr>
      <td style="${SERIF}font-size:15.5px;color:${K.ink};padding:9px 0;border-top:1px solid ${K.hair}">${esc(x.title)}<div style="${SANS}font-size:12px;color:${x.status === "red" ? K.red : K.yellow}">${esc(x.note)}</div></td>
      <td align="right" style="${SANS}font-size:12.5px;color:${K.mute};padding:9px 0;border-top:1px solid ${K.hair};white-space:nowrap">${x.days ?? "–"} napja áll<br>${money(x.holding)} tartási költség</td></tr>`).join("")}
      <tr><td colspan="2" style="${SANS}font-size:12.5px;color:${K.green};padding:9px 0;border-top:1px solid ${K.hair}">${c.top.length ? `A többi ${c.greenCount} autó rendben van, a célár fölött.` : `Mind a ${c.greenCount} autó rendben van, a célár fölött.`}</td></tr></table></td></tr>`);
  }

  if (b.finance) {
    const f = s.finance;
    rows.push(head("Tegnapi egyéb történések", `${shortD(s.day)} · ${f.entryCount} tétel`));
    rows.push(`<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${f.entries.length ? f.entries.slice(0, 8).map((e) => `<tr>
      <td style="${SANS}font-size:13px;color:${K.ink};padding:7px 0;border-bottom:1px dotted ${K.hair}">${esc(e.label)}</td>
      <td style="${MONO}font-size:11.5px;color:${K.mute};padding:7px 8px;border-bottom:1px dotted ${K.hair}" align="right">${esc(`${e.debit} / ${e.credit}`)}</td>
      <td align="right" style="${SERIF}font-size:14.5px;color:${K.ink};padding:7px 0;border-bottom:1px dotted ${K.hair};white-space:nowrap">${money(e.amount)}</td></tr>`).join("")
      : `<tr><td style="${SANS}font-size:13px;color:${K.mute}">Tegnap nem volt könyvelés.</td></tr>`}</table>
      <div style="${SANS}font-size:12.5px;color:${K.mute};padding-top:10px">Ebben a hónapban eddig ${f.vatBalance > 0 ? "fizetendő" : "visszajáró"} ÁFA: <b style="color:${K.ink}">${money(Math.abs(f.vatBalance))}</b> · Várható pénz 30 nap múlva: <b style="color:${K.ink}">${f.cashIn30 != null ? money(f.cashIn30) : "–"}</b></div></td></tr>`);
  }

  rows.push(`<tr><td align="center" style="padding:28px 0 0;border-top:1px solid ${K.rule};${SANS}font-size:11px;letter-spacing:.06em;color:${K.mute}">Mogyorosi Holding™ · ${s.date.slice(0, 4)} · v${APP_VERSION}${href(`/c/${s.companyId}`) ? ` · ${A(`/c/${s.companyId}`, "Megnyitás az ERP-ben →", K.accent)}` : ""}</td></tr>`);
  return shell(K.bg, s.headline, `<tr><td style="background:${K.paper};padding:26px 30px 26px;border:1px solid ${K.hair}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.join("\n")}</table></td></tr>`);
}

const paper = (rows: string[], pre: string) =>
  shell(K.bg, pre, `<tr><td style="background:${K.paper};padding:26px 30px 26px;border:1px solid ${K.hair}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.join("\n")}</table></td></tr>`);
const td = (inner: string, opts = "") => `<td style="${SANS}font-size:13px;color:${K.ink};padding:8px 6px;border-bottom:1px dotted ${K.hair};${opts}">${inner}</td>`;
const tdr = (inner: string, opts = "") => td(inner, `text-align:right;white-space:nowrap;${opts}`);
const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

// --- holding e-mail -----------------------------------------------------------
function holdingHtml(h: HoldingSnapshot): string {
  const T = h.totals;
  const C = h.companies;
  const S = (f: (c: CompanySnapshot) => number) => C.reduce((a, c) => a + f(c), 0);
  const liquidity = S((c) => c.kpi.liquidity);
  const fcAll = C.filter((c) => !c.private);
  // várható év végi eredmény: a kereskedő cégeknél a Forecast (ha nincs, a tény), a magánszemélynél a tény
  const yearFc = fcAll.some((c) => c.results.yearForecast != null) ? S((c) => (c.private ? c.results.year : c.results.yearForecast ?? c.results.year)) : null;
  const rows: string[] = [];

  rows.push(`<tr><td style="padding:0 0 6px;border-bottom:1px solid ${K.rule}"><table role="presentation" width="100%"><tr>
    <td style="${SANS}font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:${K.mute}">${esc(dayLabel(h.date))}</td>
    <td align="right" style="${SANS}font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:${K.mute}">Tulajdonosi összefoglaló</td></tr></table></td></tr>`);
  rows.push(`<tr><td align="center" style="padding:14px 0 4px;${SERIF}font-size:40px;font-weight:700;color:${K.ink};letter-spacing:-.01em;line-height:1.05">Mogyorosi Holding</td></tr>`);
  rows.push(`<tr><td align="center" style="padding:2px 0 12px;border-bottom:3px double ${K.rule};${SANS}font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${K.accent}">Napi összefoglaló · ${C.length} cég egyben</td></tr>`);
  rows.push(`<tr><td style="padding:22px 0 18px">${kick("Összefoglaló")}<div style="${SERIF}font-size:25px;line-height:1.28;color:${K.ink};padding-top:8px">${esc(h.headline)}</div></td></tr>`);
  const diff = T.mtdResult - T.prevMtdResult;
  rows.push(`<tr><td style="padding:16px 0;border-top:1px solid ${K.hair};border-bottom:1px solid ${K.hair}">${vrule([
    figure("Összes pénz", money(liquidity), "minden cég, mai árfolyamon"),
    figure("Ebben a hónapban", money(T.mtdResult, true), `${diff >= 0 ? "▲" : "▼"} az előző hónap ugyanekkor: ${money(T.prevMtdResult, true)}`, sign(T.mtdResult)),
    figure("Idén eddig", money(T.ytdResult, true), yearFc != null ? `várható év végére: ${money(yearFc, true)}` : "", sign(T.ytdResult)),
  ])}</td></tr>`);

  // cégenként
  rows.push(head("Cégenként"));
  const sig = (c: CompanySnapshot) => {
    const o = c.todos.filter((t) => t.level !== "green"), r = o.filter((t) => t.level === "red").length;
    return o.length ? `<span style="color:${r ? K.red : K.yellow};font-weight:700">${o.length}${r ? " (sürgős)" : ""}</span>` : `<span style="color:${K.green}">–</span>`;
  };
  rows.push(`<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>${["Cég", "Pénz", "Tegnapi bevétel", "E havi eredmény", "Eladó autó", "Teendő"].map((x, i) => `<td style="${SANS}font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:${K.mute};padding:6px;border-bottom:1px solid ${K.rule};${i ? "text-align:right" : ""}">${x}</td>`).join("")}</tr>
    ${C.map((c) => `<tr>${td(A(`/c/${c.companyId}`, `<span style="${SERIF}font-size:15px;color:${K.ink}">${esc(c.name)}</span>`, K.ink))}${tdr(money(c.kpi.liquidity))}${tdr(money(c.kpi.revenueDay))}${tdr(money(c.finance.mtdResult, true), `color:${sign(c.finance.mtdResult)}`)}${tdr(c.kpi.stock != null ? `${c.kpi.stock} db` : "–")}${tdr(sig(c))}</tr>`).join("")}
    <tr>${td(`<b>Összesen</b>`)}${tdr(`<b>${money(liquidity)}</b>`)}${tdr(`<b>${money(T.revenueDay)}</b>`)}${tdr(`<b>${money(T.mtdResult, true)}</b>`)}${tdr(`<b>${T.stock} db</b>`)}${tdr("")}</tr>
  </table></td></tr>`);

  // pénz és kötelezettségek
  rows.push(head("Pénz és kötelezettségek", "következő 14 nap"));
  const ser = h.cashSeries, mx = Math.max(1, ...ser), mn = Math.min(0, ...ser);
  const spark = ser.length > 1 ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr valign="bottom" style="height:44px">${ser.map((x, i) => `<td valign="bottom" style="padding:0 1px"><div style="height:${Math.max(2, Math.round(((x - mn) / (mx - mn || 1)) * 42))}px;background:${i === ser.length - 1 ? K.accent : "#9fbfb2"}"></div></td>`).join("")}</tr></table>` : "";
  const coverTxt = T.cover == null ? "nincs fizetendő" : `${T.cover.toFixed(1).replace(".", ",")}×`;
  const coverCol = T.cover == null || T.cover >= 2 ? K.green : T.cover >= 1 ? K.yellow : K.red;
  rows.push(`<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
    <td valign="bottom" width="54%" style="padding-right:16px"><div style="${SANS}font-size:11px;color:${K.mute};padding-bottom:6px">A cégcsoport pénze az elmúlt 30 napban</div>${spark}</td>
    <td valign="bottom" width="46%" style="padding-left:16px;border-left:1px solid ${K.hair}">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>${td("Adó, járulék (fizetendő)")}${tdr(money(S((c) => c.extra.taxLiability)))}</tr>
        <tr>${td("Szállítók 14 napon belül")}${tdr(money(S((c) => c.extra.payablesDue14)))}</tr>
        <tr>${td(`<b>Ennyiszer fedezi a pénz</b>`, "border-bottom:0")}${tdr(`<b style="${SERIF}font-size:18px;color:${coverCol}">${coverTxt}</b>`, "border-bottom:0")}</tr>
      </table></td></tr></table></td></tr>`);

  // teendők + határidők
  const todos = C.flatMap((c) => c.todos.filter((t) => t.level !== "green").map((t) => ({ ...t, company: c.name })))
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));
  const todoCol = `${kick("Teendők")}<div style="${SERIF}font-size:19px;font-style:italic;color:${K.ink};padding:6px 0 4px">${todos.length ? `${todos.length === 1 ? "Egy" : todos.length === 2 ? "Két" : todos.length} dolog vár rád` : "Nincs teendő"}</div>
    ${todos.length ? todos.map((t) => `<div style="${SANS}font-size:13px;line-height:1.45;color:${K.ink};padding:7px 0;border-top:1px solid ${K.hair}"><span style="color:${LV[t.level]};font-weight:700">${t.level === "red" ? "■" : "□"}</span>&nbsp; <b>${esc(t.company)}</b> · ${A(t.path, esc(t.text), K.ink)}</div>`).join("")
      : `<div style="${SANS}font-size:13.5px;color:${K.green}">Minden rendben, ma nincs mit intézni.</div>`}`;
  // határidők: azonos nap + bevallás egy sorban, a cégek felsorolva
  const dlMap = new Map<string, { t: string; d: { date: string; days: number }; cs: string[] }>();
  for (const c of C) for (const [t, d] of [["ÁFA-bevallás", c.deadlines.vat], ["Járulékbevallás", c.deadlines.payroll]] as const) {
    if (!d) continue;
    const k = `${d.date}|${t}`;
    dlMap.set(k, { t, d, cs: [...(dlMap.get(k)?.cs ?? []), c.name] });
  }
  const dl = [...dlMap.values()].sort((a, b) => a.d.date.localeCompare(b.d.date));
  const calCol = `${kick("Határidők")}${dl.map((x) => `<div style="${SANS}font-size:12.5px;color:${K.ink};padding:7px 0;border-top:1px solid ${K.hair}"><b style="color:${x.d.days <= 5 ? K.red : K.ink}">${shortD(x.d.date)} · ${x.t}</b> <span style="color:${K.mute}">(${x.d.days === 0 ? "ma" : x.d.days === 1 ? "holnap" : `${x.d.days} nap múlva`})</span><br>${x.cs.map(esc).join(", ")}</div>`).join("") || `<div style="${SANS}font-size:12.5px;color:${K.mute};padding-top:6px">nincs</div>`}`;
  rows.push(`<tr><td style="padding:26px 0 0;border-top:3px double ${K.rule}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
    <td valign="top" width="64%" style="padding-right:16px">${todoCol}</td><td valign="top" width="36%" style="padding-left:16px;border-left:1px solid ${K.hair}">${calCol}</td></tr></table></td></tr>`);

  // autók
  if (T.stock) {
    const L = h.lanes;
    rows.push(head("Autók", "minden cég, KészletMérleg szerint"));
    const lane = (lbl: string, k: keyof typeof L, col: string) => `<tr>${td(`<span style="color:${col};font-weight:700">■</span>&nbsp; ${lbl}`)}${tdr(`${L[k].count} db`)}${tdr(money(L[k].capital))}${tdr(money(L[k].holding))}</tr>`;
    rows.push(`<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>${["", "Autó", "Autókban álló pénz", "Tartási költség"].map((x, i) => `<td style="${SANS}font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:${K.mute};padding:6px;border-bottom:1px solid ${K.rule};${i ? "text-align:right" : ""}">${x}</td>`).join("")}</tr>
      ${lane("Rendben, a célár fölött", "green", K.green)}${lane("A célár alatt", "yellow", K.yellow)}${lane("Beavatkozni kell", "red", K.red)}
    </table>
    <div style="${SERIF}font-size:15px;font-style:italic;color:${K.accent};padding-top:12px">${h.bestSale ? `A hónap legjobb eladása: ${esc(h.bestSale.title)} (${esc(h.bestSale.company)}), ${money(h.bestSale.f2, true)} nettó fedezettel. ` : ""}Legutóbbi eladás: ${C.filter((c) => c.cars).map((c) => `${esc(c.name)} ${c.cars!.daysSinceSale == null ? "–" : c.cars!.daysSinceSale === 0 ? "ma" : c.cars!.daysSinceSale === 1 ? "tegnap" : `${c.cars!.daysSinceSale} napja`}`).join(", ")}.</div></td></tr>`);
  }

  // tagi kölcsön, vendégház
  const gh = C.filter((c) => c.extra.guesthouse);
  if (T.memberLoans > 0.5 || gh.length) {
    rows.push(head("Tagi kölcsön és vendégház"));
    const r2: string[] = [];
    for (const c of C) if (c.extra.memberLoans > 0.5) r2.push(`<tr>${td(`Tagi kölcsön egyenlege · ${esc(c.name)}`)}${tdr(money(c.extra.memberLoans))}</tr>`);
    for (const c of gh) {
      const g = c.extra.guesthouse!;
      r2.push(`<tr>${td(`${esc(c.name)} · kihasználtság ebben a hónapban`)}${tdr(g.occupancy != null ? `${Math.round(g.occupancy * 100)}%` : "–")}</tr>`);
      r2.push(`<tr>${td(`${esc(c.name)} · következő vendég érkezik`)}${tdr(g.nextStay ? shortD(g.nextStay) : "nincs foglalás")}</tr>`);
    }
    rows.push(`<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${r2.join("")}</table></td></tr>`);
  }

  rows.push(`<tr><td align="center" style="padding:28px 0 0;border-top:1px solid ${K.rule};${SANS}font-size:11px;letter-spacing:.06em;color:${K.mute}">Mogyorosi Holding™ · ${h.date.slice(0, 4)} · v${APP_VERSION}${href("/") ? ` · ${A("/", "Cégeim megnyitása →", K.accent)}` : ""}</td></tr>`);
  return paper(rows, h.headline);
}

// --- kifelé ---------------------------------------------------------------------
export function renderCompanyMail(s: CompanySnapshot, v: Variant): Mail {
  const html = companyHtml(s, v);
  const b = BLOCKS[v];
  const L: string[] = [`${s.name} – napi összefoglaló, ${dayLabel(s.date)}`, "", s.headline, "",
    `Összes pénz: ${money(s.kpi.liquidity)} (pénztár ${money(s.kpi.liquidity - s.kpi.bank)} · bank ${money(s.kpi.bank)}) · Tegnapi bevétel: ${money(s.kpi.revenueDay)} (előző 30 nap: ${money(s.kpi.revenue30)})`,
    `Eredmény – ebben a hónapban: ${money(s.results.month, true)}, ebben a negyedévben: ${money(s.results.quarter, true)}, idén eddig: ${money(s.results.year, true)}${s.results.yearForecast != null ? `, várható éves: ${money(s.results.yearForecast, true)}` : ""}`,
    `Határidők – ÁFA: ${s.deadlines.vat ? shortD(s.deadlines.vat.date) : "–"}, járulék: ${s.deadlines.payroll ? shortD(s.deadlines.payroll.date) : "–"}`, "", "TEENDŐK"];
  for (const t of openTodos(s)) L.push(`- ${t.text}`);
  if (!openTodos(s).length) L.push("Minden rendben.");
  if (b.cars && s.cars) { L.push("", "AUTÓK"); for (const x of s.cars.top) L.push(`- ${x.title}: ${x.days ?? "–"} napja áll, ${x.note}`); }
  if (b.finance) { L.push("", "TEGNAPI EGYÉB TÖRTÉNÉSEK"); for (const e of s.finance.entries.slice(0, 8)) L.push(`- ${e.label}: ${money(e.amount)}`); }
  L.push("", `Mogyorosi Holding™ · v${APP_VERSION}`);
  return { subject: subject(s), html, text: plain(L.join("\n")) };
}

export function renderHoldingMail(h: HoldingSnapshot): Mail {
  const open = h.companies.reduce((a, c) => a + c.todos.filter((t) => t.level !== "green").length, 0);
  const text = [`Mogyorosi Holding – napi összefoglaló, ${dayLabel(h.date)}`, "", h.headline, "",
    ...h.companies.map((c) => `${c.name}: pénz ${money(c.kpi.liquidity)}, e havi eredmény ${money(c.finance.mtdResult, true)}`), "",
    ...h.companies.flatMap((c) => openTodos(c).map((t) => `- ${c.name}: ${t.text}`)), "", `Mogyorosi Holding™ · v${APP_VERSION}`].join("\n");
  return { subject: `Mogyorosi Holding – napi összefoglaló, ${shortD(h.date)}${open ? ` · ${open} teendő` : " · minden rendben"}`, html: holdingHtml(h), text };
}
