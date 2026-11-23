/**
 * v3.9.4 – A cégszintű napi összefoglaló három dizájnja (választásra):
 *   1 · „Cockpit” – sötét, műszerfal-hangulat, nagy számok, visszaszámláló határidők
 *   2 · „Napilap” – világos, szerkesztőségi (pénzügyi napilap) stílus, serif címek
 *   3 · „Fintech” – élénk, kártyás, mobilapp-hangulat, színes sávok
 * Mind e-mail-biztos: táblázatos elrendezés, inline stílusok, kép és JS nélkül.
 */
import type { CompanySnapshot, Level } from "./data";
import { money } from "./format";
import { appUrl, dayLabel, type Mail, type Variant } from "./render";
import { APP_VERSION } from "@/lib/version";

export type Design = 1 | 2 | 3;
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
const grid = (cells: string[], gap = 8) =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${cells.map((c, i) => `<td valign="top" width="${Math.floor(100 / cells.length)}%" style="padding-left:${i ? gap : 0}px">${c}</td>`).join("")}</tr></table>`;
const subject = (s: CompanySnapshot) => {
  const open = s.todos.filter((t) => t.level !== "green").length;
  return `${s.name} – napi összefoglaló, ${shortD(s.date)}${open ? ` · ${open} teendő` : " · minden rendben"}`;
};
const openTodos = (s: CompanySnapshot) => s.todos.filter((t) => t.level !== "green");

// =============================================================================
// 1 · COCKPIT
// =============================================================================
function cockpit(s: CompanySnapshot, v: Variant): string {
  const b = BLOCKS[v];
  const K = { bg: "#0b1220", card: "#121b2e", card2: "#17223a", line: "#24314d", ink: "#eef3ff", mute: "#8b9bbd", dim: "#5d6d8f", accent: "#4cc9f0", gold: "#f7c948", green: "#3ddc97", red: "#ff5d73", yellow: "#ffb547" };
  const LV: Record<Level, string> = { red: K.red, yellow: K.yellow, green: K.green };
  const label = (t: string) => `<div style="${SANS}font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:${K.mute};font-weight:600">${esc(t)}</div>`;
  const card = (inner: string, pad = "16px 18px", bg = K.card) => `<div style="background:${bg};border:1px solid ${K.line};border-radius:16px;padding:${pad}">${inner}</div>`;
  const sec = (t: string, right = "") => `<tr><td style="padding:22px 4px 8px"><table role="presentation" width="100%"><tr><td>${label(t)}</td><td align="right" style="${SANS}font-size:11px;color:${K.dim}">${right}</td></tr></table></td></tr>`;
  const big = (n: string, color = K.ink, size = 30) => `<div style="${SANS}font-size:${size}px;font-weight:700;color:${color};letter-spacing:-.02em;line-height:1.1;padding-top:6px;white-space:nowrap">${n}</div>`;
  const signed = (n: number) => (n >= 0 ? K.green : K.red);
  const rows: string[] = [];

  // fejléc
  rows.push(`<tr><td style="padding:4px 4px 14px"><table role="presentation" width="100%"><tr>
    <td style="${SANS}font-size:13px;font-weight:700;color:${K.ink}"><span style="color:${K.accent}">▮▮▮</span>&nbsp; mogyorosi<span style="color:${K.accent}">.erp</span></td>
    <td align="right" style="${SANS}font-size:12px;color:${K.mute}">${esc(dayLabel(s.date))}</td></tr></table></td></tr>`);
  // hero
  rows.push(`<tr><td>${card(`
    ${label(`${s.name} · napi jelentés`)}
    <div style="${SANS}font-size:21px;line-height:1.35;color:${K.ink};font-weight:600;padding:10px 0 18px">${esc(s.headline)}</div>
    ${grid([
      `<div style="border-left:3px solid ${K.gold};padding-left:12px">${label("Ft pénztár egyenleg")}${big(money(s.kpi.cashHuf), K.gold)}</div>`,
      `<div style="border-left:3px solid ${K.accent};padding-left:12px">${label("Összes likviditás · napi értéken")}${big(money(s.kpi.liquidity), K.accent)}</div>`,
    ], 18)}
    <div style="height:16px"></div>
    ${grid([
      `<div style="background:${K.card2};border-radius:10px;padding:10px 12px">${label(`Bevétel ${shortD(s.day)}`)}${big(money(s.kpi.revenueDay), K.ink, 17)}</div>`,
      `<div style="background:${K.card2};border-radius:10px;padding:10px 12px">${label("Készleten")}${big(s.kpi.stock != null ? `${s.kpi.stock} autó` : "–", K.ink, 17)}</div>`,
      `<div style="background:${K.card2};border-radius:10px;padding:10px 12px">${label("Lejárt vevő")}${big(s.kpi.lateReceivableCount ? money(s.kpi.lateReceivable) : "0 Ft", s.kpi.lateReceivableCount ? K.red : K.ink, 17)}</div>`,
    ])}`, "22px 22px 20px")}</td></tr>`);

  // eredmények
  const r = s.results;
  const p = pct(r.year, r.yearForecast);
  rows.push(sec("Eredmény", "adózás előtt"));
  rows.push(`<tr><td>${card(`
    ${grid([
      `${label(`Folyó hó · ${HU_M[Number(s.date.slice(5, 7)) - 1]}`)}${big(money(r.month, true), signed(r.month), 20)}`,
      `${label(`Folyó ${qLabel(s.date)}`)}${big(money(r.quarter, true), signed(r.quarter), 20)}`,
      `${label(`Folyó év · ${s.date.slice(0, 4)}`)}${big(money(r.year, true), signed(r.year), 20)}`,
    ], 14)}
    <div style="height:18px;border-bottom:1px solid ${K.line}"></div>
    <table role="presentation" width="100%" style="margin-top:14px"><tr>
      <td>${label(`Teljes év ${s.date.slice(0, 4)} · Forecast alapján`)}${big(r.yearForecast != null ? money(r.yearForecast, true) : "nincs Forecast", r.yearForecast != null ? K.gold : K.dim, 26)}
      ${r.yearForecastAfterTax != null ? `<div style="${SANS}font-size:12px;color:${K.mute};padding-top:3px">adózás után ${money(r.yearForecastAfterTax, true)}</div>` : ""}</td>
      ${p != null ? `<td align="right" valign="bottom" style="${SANS}font-size:12px;color:${K.mute}"><span style="font-size:22px;font-weight:700;color:${K.ink}">${p}%</span><br>teljesítve</td>` : ""}
    </tr></table>
    ${p != null ? `<div style="height:8px;border-radius:4px;background:${K.card2};margin-top:12px"><div style="height:8px;border-radius:4px;width:${p}%;background:${K.gold}"></div></div>` : ""}
  `)}</td></tr>`);

  // határidők
  const dl = (t: string, d: { date: string; days: number } | null) => {
    if (!d) return card(`${label(t)}${big("–", K.dim, 20)}<div style="${SANS}font-size:12px;color:${K.dim}">nincs bevallási kötelezettség</div>`);
    const c = d.days <= 5 ? K.red : d.days <= 10 ? K.yellow : K.green;
    return card(`<table role="presentation" width="100%"><tr><td>${label(t)}<div style="${SANS}font-size:15px;color:${K.ink};font-weight:600;padding-top:8px">${d.date.replaceAll("-", ".")}.</div></td>
      <td align="right"><div style="${SANS}font-size:34px;font-weight:800;color:${c};line-height:1">${d.days}</div><div style="${SANS}font-size:10.5px;color:${K.mute};letter-spacing:.1em;text-transform:uppercase">nap</div></td></tr></table>`);
  };
  rows.push(sec("Határidők"));
  rows.push(`<tr><td>${grid([dl("ÁFA-bevallás", s.deadlines.vat), dl("Járulékbevallás", s.deadlines.payroll)], 10)}</td></tr>`);

  // teendők
  const td = openTodos(s);
  rows.push(sec("Teendők", td.length ? `${td.length} nyitott` : ""));
  rows.push(`<tr><td>${card(td.length ? td.map((t, i) => `<table role="presentation" width="100%" style="${i ? `border-top:1px solid ${K.line};` : ""}"><tr>
      <td width="6" style="background:${LV[t.level]};border-radius:3px"></td>
      <td style="${SANS}font-size:14px;color:${K.ink};padding:11px 12px">${A(t.path, esc(t.text), K.ink)}</td>
      <td align="right" style="${SANS}font-size:11px;color:${LV[t.level]};font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap">${t.level === "red" ? "sürgős" : "figyelj"}</td></tr></table>`).join("")
    : `<div style="${SANS}font-size:15px;color:${K.green};font-weight:600">✓ Minden rendben – nincs teendő.</div>`, "6px 16px")}</td></tr>`);

  // autók
  if (b.cars && s.cars) {
    const c = s.cars;
    rows.push(sec("Autókészlet", "KészletMérleg"));
    const max = Math.max(1, ...c.top.map((x) => x.days ?? 0));
    rows.push(`<tr><td>${card(`
      ${grid([
        `${label("Utolsó eladás óta")}${big(c.daysSinceSale != null ? `${c.daysSinceSale} nap` : "–", K.ink, 20)}`,
        `${label("Lekötött tőke")}${big(money(c.capital), K.ink, 20)}`,
        `${label("Átl. napok készleten")}${big(c.avgDays != null ? String(c.avgDays) : "–", K.ink, 20)}`,
      ], 14)}
      ${c.soldDay.length ? `<div style="${SANS}font-size:13px;color:${K.green};padding-top:14px">▲ Tegnap eladva: ${c.soldDay.map((x) => `<b>${esc(x.title)}</b> (${money(x.f2, true)} nettó fedezet)`).join(", ")}</div>` : ""}
      <div style="height:6px"></div>
      ${c.top.map((x) => {
        const col = x.status === "red" ? K.red : K.yellow;
        return `<div style="padding-top:12px"><table role="presentation" width="100%"><tr><td style="${SANS}font-size:13.5px;color:${K.ink};font-weight:600">${esc(x.title)}</td>
          <td align="right" style="${SANS}font-size:12px;color:${K.mute}">${x.days ?? "–"} nap · ${money(x.holding)}</td></tr></table>
          <div style="height:6px;border-radius:3px;background:${K.card2};margin:6px 0 4px"><div style="height:6px;border-radius:3px;width:${Math.max(4, Math.round(((x.days ?? 0) / max) * 100))}%;background:${col}"></div></div>
          <div style="${SANS}font-size:12px;color:${col}">${esc(x.note)}</div></div>`;
      }).join("")}
      <div style="${SANS}font-size:12.5px;color:${K.green};padding-top:14px">● ${c.greenCount} autó a cél ár fölött</div>
    `)}</td></tr>`);
  }

  // pénzügyi napló
  if (b.finance) {
    const f = s.finance;
    rows.push(sec("Pénzügyi napló", `${shortD(s.day)} · ${f.entryCount} tétel`));
    rows.push(`<tr><td>${card(`${f.entries.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${f.entries.slice(0, 8).map((e, i) => `<tr>
        <td style="${SANS}font-size:13px;color:${K.ink};padding:8px 0;${i ? `border-top:1px solid ${K.line};` : ""}">${esc(e.label)}</td>
        <td align="right" style="${MONO}font-size:12px;color:${K.mute};padding:8px 10px;${i ? `border-top:1px solid ${K.line};` : ""}">${esc(`${e.debit} / ${e.credit}`)}</td>
        <td align="right" style="${SANS}font-size:13px;color:${K.ink};font-weight:600;white-space:nowrap;${i ? `border-top:1px solid ${K.line};` : ""}">${money(e.amount)}</td></tr>`).join("")}</table>`
      : `<div style="${SANS}font-size:13px;color:${K.mute}">Tegnap nem volt könyvelés.</div>`}
      <div style="height:14px"></div>
      ${grid([`${label("Havi ÁFA-pozíció")}${big(money(-f.vatBalance, true), K.ink, 17)}`, `${label("30 nap múlva pénz")}${big(f.cashIn30 != null ? money(f.cashIn30) : "–", K.ink, 17)}`], 14)}`)}</td></tr>`);
  }

  rows.push(`<tr><td style="${SANS}font-size:11.5px;color:${K.dim};padding:22px 4px 4px" align="center">Mogyorosi Holding™ · ${s.date.slice(0, 4)} · ${esc(s.name)} · v${APP_VERSION}${href(`/c/${s.companyId}`) ? ` · ${A(`/c/${s.companyId}`, "Megnyitás az ERP-ben →", K.accent)}` : ""}</td></tr>`);
  return shell(K.bg, s.headline, rows.join("\n"));
}

// =============================================================================
// 2 · NAPILAP
// =============================================================================
function napilap(s: CompanySnapshot, v: Variant): string {
  const b = BLOCKS[v];
  const K = { bg: "#efe9dd", paper: "#fbf8f1", ink: "#1b1a17", mute: "#6b655a", rule: "#1b1a17", hair: "#d9d1c1", accent: "#0f5a43", red: "#a3261c", yellow: "#9a6a00", green: "#0f5a43" };
  const LV: Record<Level, string> = { red: K.red, yellow: K.yellow, green: K.green };
  const kick = (t: string) => `<div style="${SANS}font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:${K.accent};font-weight:700">${esc(t)}</div>`;
  const head = (t: string, right = "") => `<tr><td style="padding:26px 0 10px;border-top:3px double ${K.rule}"><table role="presentation" width="100%"><tr><td style="${SERIF}font-size:22px;font-style:italic;color:${K.ink}">${esc(t)}</td><td align="right" style="${SANS}font-size:11px;color:${K.mute}">${right}</td></tr></table></td></tr>`;
  const figure = (lbl: string, val: string, note = "", color = K.ink) => `<div style="${SANS}font-size:11px;color:${K.mute};text-transform:uppercase;letter-spacing:.08em">${esc(lbl)}</div>
    <div style="${SERIF}font-size:26px;color:${color};line-height:1.15;padding-top:4px;white-space:nowrap">${val}</div>${note ? `<div style="${SANS}font-size:11.5px;color:${K.mute};padding-top:2px">${note}</div>` : ""}`;
  const vrule = (cells: string[]) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${cells.map((c, i) => `<td valign="top" width="${Math.floor(100 / cells.length)}%" style="padding:0 ${i < cells.length - 1 ? 14 : 0}px 0 ${i ? 14 : 0}px;${i ? `border-left:1px solid ${K.hair};` : ""}">${c}</td>`).join("")}</tr></table>`;
  const sign = (n: number) => (n >= 0 ? K.ink : K.red);
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
  rows.push(`<tr><td style="padding:16px 0;border-top:1px solid ${K.hair};border-bottom:1px solid ${K.hair}">${vrule([
    figure("Pénztár (Ft)", money(s.kpi.cashHuf), "forintpénztár egyenlege"),
    figure("Összes pénz", money(s.kpi.liquidity), "pénztár + bank, mai árfolyamon"),
    figure("Tegnapi bevétel", money(s.kpi.revenueDay), shortD(s.day)),
  ])}</td></tr>`);
  rows.push(`<tr><td style="padding:10px 0 0;${SANS}font-size:12.5px;color:${K.mute}">Eladó autó: <b style="color:${K.ink}">${s.kpi.stock ?? "–"} db</b> &nbsp;·&nbsp; Lejárt vevői tartozás: <b style="color:${s.kpi.lateReceivableCount ? K.red : K.ink}">${s.kpi.lateReceivableCount ? money(s.kpi.lateReceivable) : "nincs"}</b></td></tr>`);

  // eredmény-rovat
  const r = s.results;
  const p = pct(r.year, r.yearForecast);
  rows.push(head("Eredmény", "adózás előtt"));
  const line = (t: string, n: number | null, strong = false, note = "") => `<tr>
    <td style="${SERIF}font-size:${strong ? 19 : 16}px;color:${K.ink};padding:9px 0;border-bottom:1px dotted ${K.hair};${strong ? "font-weight:700;" : ""}">${esc(t)}${note ? `<span style="${SANS}font-size:11.5px;color:${K.mute};font-weight:400"> · ${note}</span>` : ""}</td>
    <td align="right" style="${SERIF}font-size:${strong ? 21 : 17}px;color:${n == null ? K.mute : strong ? K.accent : sign(n)};padding:9px 0;border-bottom:1px dotted ${K.hair};white-space:nowrap;${strong ? "font-weight:700;" : ""}">${n == null ? "nincs Forecast" : money(n, true)}</td></tr>`;
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
    rows.push(head("Tegnapi könyvelések", `${shortD(s.day)} · ${f.entryCount} tétel`));
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

// =============================================================================
// 3 · FINTECH
// =============================================================================
function fintech(s: CompanySnapshot, v: Variant): string {
  const b = BLOCKS[v];
  const K = { bg: "#eef0f8", card: "#ffffff", ink: "#14162b", mute: "#6a6f8c", line: "#eceef6", hero: "#4338ca", hero2: "#5b50e8", mint: "#16c79a", mintBg: "#e3faf3", coral: "#ff5a5f", coralBg: "#ffe9ea", amber: "#f59e0b", amberBg: "#fff4dd", lilacBg: "#efedff" };
  const LV: Record<Level, [string, string]> = { red: [K.coral, K.coralBg], yellow: [K.amber, K.amberBg], green: [K.mint, K.mintBg] };
  const card = (inner: string, pad = "18px 20px") => `<div style="background:${K.card};border-radius:22px;padding:${pad}">${inner}</div>`;
  const title = (t: string, right = "") => `<table role="presentation" width="100%"><tr><td style="${SANS}font-size:16px;font-weight:800;color:${K.ink}">${esc(t)}</td><td align="right" style="${SANS}font-size:12px;color:${K.mute}">${right}</td></tr></table><div style="height:12px"></div>`;
  const chip = (txt: string, fg: string, bg: string) => `<span style="${SANS}display:inline-block;font-size:11.5px;font-weight:700;color:${fg};background:${bg};border-radius:999px;padding:3px 10px;white-space:nowrap">${txt}</span>`;
  const gap = `<tr><td style="height:12px"></td></tr>`;
  const rows: string[] = [];

  // hero
  rows.push(`<tr><td><div style="background:${K.hero};border-radius:26px;padding:22px 22px 20px">
    <table role="presentation" width="100%"><tr><td style="${SANS}font-size:13px;font-weight:800;color:#ffffff">mogyorosi<span style="color:#a5b4fc">.erp</span></td>
      <td align="right">${chip(esc(dayLabel(s.date, false)), "#e0e7ff", K.hero2)}</td></tr></table>
    <div style="${SANS}font-size:13px;color:#c7d2fe;padding-top:18px">${esc(s.name)} · összes likviditás napi értéken</div>
    <div style="${SANS}font-size:42px;font-weight:800;color:#ffffff;letter-spacing:-.03em;line-height:1.1;padding-top:4px">${money(s.kpi.liquidity)}</div>
    <div style="${SANS}font-size:14.5px;line-height:1.45;color:#e0e7ff;padding-top:10px">${esc(s.headline)}</div>
    <div style="height:16px"></div>
    ${grid([
      `<div style="background:${K.hero2};border-radius:16px;padding:12px 14px"><div style="${SANS}font-size:11.5px;color:#c7d2fe">Ft pénztár</div><div style="${SANS}font-size:18px;font-weight:800;color:#fff;padding-top:3px;white-space:nowrap">${money(s.kpi.cashHuf)}</div></div>`,
      `<div style="background:${K.hero2};border-radius:16px;padding:12px 14px"><div style="${SANS}font-size:11.5px;color:#c7d2fe">Bevétel ${shortD(s.day)}</div><div style="${SANS}font-size:18px;font-weight:800;color:#fff;padding-top:3px;white-space:nowrap">${money(s.kpi.revenueDay)}</div></div>`,
      `<div style="background:${K.hero2};border-radius:16px;padding:12px 14px"><div style="${SANS}font-size:11.5px;color:#c7d2fe">Készleten</div><div style="${SANS}font-size:18px;font-weight:800;color:#fff;padding-top:3px">${s.kpi.stock ?? "–"} autó</div></div>`,
    ])}
    ${s.kpi.lateReceivableCount ? `<div style="${SANS}font-size:12.5px;color:#fecdd3;padding-top:12px">● Lejárt vevő: ${money(s.kpi.lateReceivable)}</div>` : ""}
  </div></td></tr>`);
  rows.push(gap);

  // eredmény-oszlopok
  const r = s.results;
  const vals = [r.month, r.quarter, r.year, r.yearForecast ?? 0];
  const mx = Math.max(1, ...vals.map((x) => Math.abs(x)));
  const col = (lbl: string, n: number | null, color: string) => {
    const h = n == null ? 4 : Math.max(6, Math.round((Math.abs(n) / mx) * 96));
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td valign="bottom" height="128" style="height:128px" align="center">
      <div style="${SANS}font-size:12.5px;font-weight:800;color:${n != null && n < 0 ? K.coral : K.ink};padding-bottom:6px;white-space:nowrap">${n == null ? "–" : money(n, true)}</div>
      <div style="height:${h}px;width:74%;border-radius:12px 12px 4px 4px;background:${n != null && n < 0 ? K.coral : color}"></div></td></tr>
      <tr><td align="center" valign="top" height="36" style="${SANS}font-size:11.5px;color:${K.mute};padding-top:8px;line-height:1.3;height:36px">${lbl}</td></tr></table>`;
  };
  rows.push(`<tr><td>${card(`${title("Eredmény", "adózás előtt")}${grid([
    col(`Folyó hó`, r.month, "#a5b4fc"),
    col(`Folyó ${qLabel(s.date).replace(" negyedév", " n.év")}`, r.quarter, "#818cf8"),
    col(`Folyó év`, r.year, "#6366f1"),
    col(`Teljes év<br><b style="color:${K.hero}">Forecast</b>`, r.yearForecast, K.mint),
  ], 6)}
  ${pct(r.year, r.yearForecast) != null ? `<div style="${SANS}font-size:12.5px;color:${K.mute};padding-top:14px;text-align:center">Az éves várható eredmény ${chip(`${pct(r.year, r.yearForecast)}%`, K.hero, K.lilacBg)} része már megvan${r.yearForecastAfterTax != null ? ` · adózás után ~${money(r.yearForecastAfterTax, true)}` : ""}</div>` : ""}`)}</td></tr>`);
  rows.push(gap);

  // határidők
  const dl = (t: string, d: { date: string; days: number } | null) => {
    const [fg, bg] = !d ? [K.mute, K.line] : d.days <= 5 ? [K.coral, K.coralBg] : d.days <= 10 ? [K.amber, K.amberBg] : [K.mint, K.mintBg];
    return card(`<table role="presentation" width="100%"><tr>
      <td width="58" valign="middle"><div style="width:52px;height:52px;border-radius:16px;background:${bg};text-align:center;${SANS}font-size:21px;font-weight:800;color:${fg};line-height:52px">${d ? d.days : "–"}</div></td>
      <td style="padding-left:10px"><div style="${SANS}font-size:13.5px;font-weight:800;color:${K.ink}">${esc(t)}</div><div style="${SANS}font-size:12px;color:${K.mute};padding-top:2px">${d ? `${d.date.replaceAll("-", ".")}. · ${d.days} nap` : "nincs kötelezettség"}</div></td></tr></table>`, "14px 14px");
  };
  rows.push(`<tr><td>${grid([dl("ÁFA-bevallás", s.deadlines.vat), dl("Járulékbevallás", s.deadlines.payroll)], 12)}</td></tr>`);
  rows.push(gap);

  // teendők
  const td = openTodos(s);
  rows.push(`<tr><td>${card(`${title("Teendők", td.length ? chip(`${td.length} nyitott`, K.coral, K.coralBg) : chip("tiszta", K.mint, K.mintBg))}
    ${td.length ? td.map((t) => `<table role="presentation" width="100%" style="margin-bottom:8px"><tr><td style="background:${LV[t.level][1]};border-radius:14px;padding:11px 14px;${SANS}font-size:13.5px;color:${K.ink}">
      <span style="color:${LV[t.level][0]};font-weight:800">●</span>&nbsp; ${A(t.path, esc(t.text), K.ink)}</td></tr></table>`).join("")
    : `<div style="${SANS}font-size:14px;color:${K.mint};font-weight:700">Minden rendben – nincs teendő.</div>`}`)}</td></tr>`);

  // autók
  if (b.cars && s.cars) {
    const c = s.cars;
    const L = c.lanes, n = Math.max(1, L.red.count + L.yellow.count + L.green.count);
    rows.push(gap);
    rows.push(`<tr><td>${card(`${title("Autókészlet", `${c.daysSinceSale != null ? `${c.daysSinceSale} napja volt eladás` : ""}`)}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:999px;overflow:hidden"><tr>
        ${L.green.count ? `<td width="${Math.round((L.green.count / n) * 100)}%" style="background:${K.mint};height:12px"></td>` : ""}
        ${L.yellow.count ? `<td width="${Math.round((L.yellow.count / n) * 100)}%" style="background:${K.amber};height:12px"></td>` : ""}
        ${L.red.count ? `<td width="${Math.round((L.red.count / n) * 100)}%" style="background:${K.coral};height:12px"></td>` : ""}
      </tr></table>
      <div style="${SANS}font-size:12px;color:${K.mute};padding:8px 0 14px">${chip(`${L.green.count} rendben`, "#0b7a5c", K.mintBg)} ${chip(`${L.yellow.count} cél alatt`, "#9a5b00", K.amberBg)} ${chip(`${L.red.count} beavatkozni`, "#c22c31", K.coralBg)} &nbsp;Lekötött tőke <b style="color:${K.ink}">${money(c.capital)}</b></div>
      ${c.soldDay.length ? `<div style="background:${K.mintBg};border-radius:14px;padding:11px 14px;${SANS}font-size:13px;color:#0b7a5c;margin-bottom:10px">▲ Tegnap eladva: <b>${c.soldDay.map((x) => esc(x.title)).join(", ")}</b> · ${money(c.soldDay.reduce((a, x) => a + x.f2, 0), true)} nettó fedezet</div>` : ""}
      ${c.top.map((x) => `<table role="presentation" width="100%" style="border-top:1px solid ${K.line}"><tr>
        <td style="padding:11px 0"><div style="${SANS}font-size:13.5px;font-weight:800;color:${K.ink}">${esc(x.title)}</div><div style="${SANS}font-size:12px;color:${K.mute};padding-top:2px">${esc(x.note)}</div></td>
        <td align="right" style="padding:11px 0">${chip(`${x.days ?? "–"} nap`, x.status === "red" ? "#c22c31" : "#9a5b00", x.status === "red" ? K.coralBg : K.amberBg)}<div style="${SANS}font-size:11.5px;color:${K.mute};padding-top:4px">${money(x.holding)} tartás</div></td></tr></table>`).join("")}`)}</td></tr>`);
  }

  if (b.finance) {
    const f = s.finance;
    rows.push(gap);
    rows.push(`<tr><td>${card(`${title("Pénzügyi napló", `${shortD(s.day)} · ${f.entryCount} tétel`)}
      ${f.entries.length ? f.entries.slice(0, 8).map((e) => `<table role="presentation" width="100%" style="border-top:1px solid ${K.line}"><tr>
        <td style="padding:9px 0"><div style="${SANS}font-size:13px;color:${K.ink};font-weight:600">${esc(e.label)}</div><div style="${MONO}font-size:11px;color:${K.mute}">${esc(`${e.debit} / ${e.credit}`)}</div></td>
        <td align="right" style="${SANS}font-size:13.5px;font-weight:800;color:${K.ink};white-space:nowrap">${money(e.amount)}</td></tr></table>`).join("")
      : `<div style="${SANS}font-size:13px;color:${K.mute}">Tegnap nem volt könyvelés.</div>`}
      <div style="${SANS}font-size:12.5px;color:${K.mute};padding-top:10px">Havi ÁFA-pozíció ${chip(money(-f.vatBalance, true), K.hero, K.lilacBg)} · 30 nap múlva ${chip(f.cashIn30 != null ? money(f.cashIn30) : "–", K.hero, K.lilacBg)}</div>`)}</td></tr>`);
  }

  rows.push(`<tr><td align="center" style="${SANS}font-size:11.5px;color:${K.mute};padding:20px 0 4px">Mogyorosi Holding™ · ${s.date.slice(0, 4)} · ${esc(s.name)} · v${APP_VERSION}${href(`/c/${s.companyId}`) ? `<br><br>${A(`/c/${s.companyId}`, `<span style="display:inline-block;background:${K.hero};color:#fff;border-radius:999px;padding:10px 20px;font-weight:800">Megnyitás az ERP-ben →</span>`, "#fff")}` : ""}</td></tr>`);
  return shell(K.bg, s.headline, rows.join("\n"));
}

export const DESIGN_LABEL: Record<Design, string> = { 1: "Cockpit", 2: "Napilap", 3: "Fintech" };

export function renderCompanyDesign(s: CompanySnapshot, v: Variant, d: Design): Mail {
  const html = d === 1 ? cockpit(s, v) : d === 2 ? napilap(s, v) : fintech(s, v);
  return { subject: subject(s), html, text: s.headline };
}
