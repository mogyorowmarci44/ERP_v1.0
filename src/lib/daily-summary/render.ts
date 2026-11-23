/**
 * v3.9.2 – Napi összefoglaló e-mail HTML (táblázatos, inline stílusú – Gmail, Outlook, telefon).
 * Cégszintű változatok blokkjai: A fejléc + számok · C teendők · D autókészlet · E pénzügyi napló.
 */
import type { CompanySnapshot, HoldingSnapshot, Level, Todo } from "./data";
import { APP_VERSION } from "@/lib/version";
import { money } from "./format";

export { money };

export type Variant = "ceo" | "cfo" | "full";
export const VARIANT_LABEL: Record<Variant, string> = {
  ceo: "Ügyvezető – számok, teendők, autókészlet",
  cfo: "Pénzügyes – számok, teendők, pénzügyi napló",
  full: "Teljes – mind a négy blokk",
};
const BLOCKS: Record<Variant, { cars: boolean; finance: boolean }> = {
  ceo: { cars: true, finance: false },
  cfo: { cars: false, finance: true },
  full: { cars: true, finance: true },
};

export type Mail = { subject: string; html: string; text: string };

// --- formázás -----------------------------------------------------------------
const nf = (d = 0) => new Intl.NumberFormat("hu-HU", { maximumFractionDigits: d, minimumFractionDigits: d, useGrouping: "always" });
const HU_MONTH_SHORT = ["jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
const HU_DAY = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
export const dayLabel = (d: string, withDow = true) =>
  `${d.slice(0, 4)}. ${HU_MONTH_SHORT[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}.${withDow ? `, ${HU_DAY[new Date(d + "T00:00:00Z").getUTCDay()]}` : ""}`;
const short = (d: string) => `${HU_MONTH_SHORT[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}.`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function appUrl(): string {
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
}

// --- színek (e-mailben nincs CSS-változó) -------------------------------------
const C = {
  ink: "#1d2430", muted: "#5b6878", faint: "#8a96a5", line: "#e3e8ee", tile: "#f3f5f8", accent: "#1f4fb8",
  red: "#c0362c", redBg: "#fbe9e7", yellow: "#946200", yellowBg: "#fdf3d7", green: "#1e7a46", greenBg: "#e5f4ea",
};
const LV: Record<Level, { fg: string; bg: string; hu: string }> = {
  red: { fg: C.red, bg: C.redBg, hu: "piros" }, yellow: { fg: C.yellow, bg: C.yellowBg, hu: "sárga" }, green: { fg: C.green, bg: C.greenBg, hu: "zöld" },
};
const F = "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;";

// --- építőkockák --------------------------------------------------------------
const link = (path: string, label: string) => {
  const base = appUrl();
  return base ? `<a href="${esc(base + path)}" style="color:${C.accent};text-decoration:none">${esc(label)}</a>` : esc(label);
};
const section = (title: string, tag = "") =>
  `<tr><td style="padding:18px 0 6px;border-top:1px solid ${C.line}"><table role="presentation" width="100%"><tr>
  <td style="${F}font-size:12px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:.04em">${esc(title)}</td>
  <td align="right" style="${F}font-size:11px;color:${C.faint}">${esc(tag)}</td></tr></table></td></tr>`;
function tiles(items: Array<[string, string, string?]>): string {
  const w = Math.floor(100 / items.length);
  return `<tr><td style="padding:10px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${items
    .map(([label, value, sub], i) => `<td width="${w}%" valign="top" style="padding:${i ? "0 0 0 6px" : "0"}">
      <div style="background:${C.tile};border-radius:8px;padding:9px 10px">
      <div style="${F}font-size:11px;color:${C.muted}">${esc(label)}</div>
      <div style="${F}font-size:17px;font-weight:600;color:${C.ink};white-space:nowrap">${esc(value)}</div>
      ${sub ? `<div style="${F}font-size:11px;color:${C.muted}">${sub}</div>` : ""}</div></td>`)
    .join("")}</tr></table></td></tr>`;
}
const dot = (l: Level) => `<span style="display:inline-block;width:9px;height:9px;border-radius:5px;background:${LV[l].fg};margin-right:8px"></span>`;
const pill = (l: Level, text = LV[l].hu) =>
  `<span style="${F}display:inline-block;font-size:11px;padding:1px 8px;border-radius:9px;background:${LV[l].bg};color:${LV[l].fg};white-space:nowrap">${esc(text)}</span>`;
function todoList(todos: Array<Todo & { company?: string }>): string {
  if (!todos.some((t) => t.level !== "green")) {
    return `<tr><td style="${F}font-size:14px;color:${C.green};padding:4px 0">${dot("green")}Minden rendben – nincs teendő.</td></tr>${todos
      .map((t) => `<tr><td style="${F}font-size:13px;color:${C.muted};padding:3px 0">${dot("green")}${link(t.path, t.text)}</td></tr>`).join("")}`;
  }
  return todos
    .map((t) => `<tr><td style="${F}font-size:13.5px;color:${t.level === "green" ? C.muted : C.ink};padding:4px 0;line-height:1.45">${dot(t.level)}${t.company ? `<b>${esc(t.company)}</b> · ` : ""}${link(t.path, t.text)}</td></tr>`)
    .join("");
}
function table(head: string[], rows: string[][], widths: string[], boldLast = false): string {
  const cell = (v: string, i: number, th: boolean, bold: boolean) =>
    `<${th ? "th" : "td"} align="${i ? "right" : "left"}" width="${widths[i] ?? ""}" style="${F}font-size:12.5px;padding:5px 6px;border-bottom:1px solid ${C.line};color:${th ? C.muted : C.ink};font-weight:${th || bold ? 600 : 400};white-space:${i ? "nowrap" : "normal"}">${v}</${th ? "th" : "td"}>`;
  return `<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    ${head.some(Boolean) ? `<tr>${head.map((h, i) => cell(esc(h), i, true, false)).join("")}</tr>` : ""}
    ${rows.map((r, ri) => `<tr>${r.map((v, i) => cell(v, i, false, boldLast && ri === rows.length - 1)).join("")}</tr>`).join("")}
  </table></td></tr>`;
}
const bar = (pct: number, l: Level) =>
  `<div style="height:6px;border-radius:3px;background:${C.tile};margin-top:4px"><div style="height:6px;border-radius:3px;width:${Math.max(3, Math.min(100, Math.round(pct)))}%;background:${LV[l].fg}"></div></div>`;
function spark(series: number[]): string {
  if (series.length < 2) return "";
  const max = Math.max(...series, 1), min = Math.min(...series, 0);
  const h = (v: number) => Math.max(2, Math.round(((v - min) / (max - min || 1)) * 40));
  return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%"><tr valign="bottom" style="height:42px">${series
    .map((v, i) => `<td style="padding:0 1px" valign="bottom"><div style="height:${h(v)}px;background:${i === series.length - 1 ? C.accent : "#9db4e4"};border-radius:1px"></div></td>`)
    .join("")}</tr></table>`;
}
function frame(preheader: string, body: string, footer: string): string {
  return `<!DOCTYPE html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(preheader)}</title></head>
<body style="margin:0;padding:0;background:#eef1f5">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef1f5"><tr><td align="center" style="padding:18px 10px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid ${C.line};border-radius:12px">
<tr><td style="padding:18px 22px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">
${body}
<tr><td style="${F}padding:18px 0 0;border-top:1px solid ${C.line};font-size:11.5px;color:${C.faint}">${footer}</td></tr>
</table></td></tr></table></td></tr></table></body></html>`;
}
const brandRow = (label: string) =>
  `<tr><td style="${F}font-size:12px;color:${C.faint};padding:0 0 6px"><span style="color:${C.accent};font-weight:700">mogyorosi.erp</span> · ${esc(label)}</td></tr>`;
const headlineRow = (s: string) => `<tr><td style="${F}font-size:17px;font-weight:600;color:${C.ink};line-height:1.35;padding:2px 0 2px">${esc(s)}</td></tr>`;
const footerText = (company: string) => `Mogyorosi Holding™ · ${new Date().getFullYear()} · ${esc(company)} · v${APP_VERSION}`;

// --- cégszintű e-mail ---------------------------------------------------------
export function renderCompanyMail(s: CompanySnapshot, variant: Variant): Mail {
  const b = BLOCKS[variant];
  const p = `/c/${s.companyId}`;
  const parts: string[] = [];
  parts.push(brandRow(`${s.name} · napi jelentés · ${dayLabel(s.date)}`));
  parts.push(headlineRow(s.headline));
  parts.push(tiles([
    ["Pénz összesen", money(s.kpi.cash)],
    [`Bevétel (${short(s.day)})`, money(s.kpi.revenueDay)],
    s.kpi.stock != null ? ["Készleten", `${s.kpi.stock} autó`] : ["Hó eddig eredmény", money(s.finance.mtdResult, true)],
    ["Lejárt vevő", s.kpi.lateReceivableCount ? money(s.kpi.lateReceivable) : "0 Ft"],
  ]));

  parts.push(section("Teendők"));
  parts.push(todoList(s.todos));

  if (b.cars && s.cars) {
    const c = s.cars;
    parts.push(section("Autókészlet", "KészletMérleg"));
    parts.push(tiles([
      ["Utolsó eladás óta", c.daysSinceSale != null ? `${c.daysSinceSale} nap` : "–"],
      ["Lekötött tőke", money(c.capital)],
      ["Átl. napok készleten", c.avgDays != null ? String(c.avgDays) : "–"],
    ]));
    if (c.soldDay.length) {
      parts.push(`<tr><td style="${F}font-size:13px;color:${C.ink};padding:2px 0 6px">Tegnap eladva: ${c.soldDay.map((x) => `<b>${esc(x.title)}</b> (${money(x.f2, true)} nettó fedezet)`).join(", ")}</td></tr>`);
    }
    const maxDays = Math.max(1, ...c.top.map((x) => x.days ?? 0));
    for (const x of c.top) {
      const l: Level = x.status === "red" ? "red" : "yellow";
      parts.push(`<tr><td style="padding:5px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
        <td width="62" valign="top">${pill(l)}</td>
        <td style="${F}font-size:13px;color:${C.ink}">${esc(x.title)} · ${x.days ?? "–"} nap · tartási ktg. ${money(x.holding)}${x.note ? ` · <span style="color:${C.muted}">${esc(x.note)}</span>` : ""}${bar(((x.days ?? 0) / maxDays) * 100, l)}</td></tr></table></td></tr>`);
    }
    parts.push(`<tr><td style="padding:5px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="62">${pill("green")}</td>
      <td style="${F}font-size:13px;color:${C.muted}">${c.greenCount} autó rendben (a cél ár fölött)</td></tr></table></td></tr>`);
    parts.push(`<tr><td style="${F}font-size:12px;padding:4px 0">${link(`${p}/vehicles/merleg`, "KészletMérleg megnyitása →")}</td></tr>`);
  }

  if (b.finance) {
    const f = s.finance;
    parts.push(section("Pénzügyi napló", `${short(s.day)} · ${f.entryCount} tétel`));
    if (f.entries.length) {
      parts.push(table(["Könyvelés", "Összeg", "T / K"], f.entries.slice(0, 8).map((e) => [esc(e.label), money(e.amount), esc(`${e.debit} / ${e.credit}`)]), ["56%", "20%", "24%"]));
      if (f.entryCount > 8) parts.push(`<tr><td style="${F}font-size:12px;color:${C.muted};padding:4px 0">…és még ${f.entryCount - 8} tétel · ${link(`${p}/journal?from=${s.day}&to=${s.day}`, "Napló")}</td></tr>`);
    } else {
      parts.push(`<tr><td style="${F}font-size:13px;color:${C.muted};padding:4px 0">Tegnap nem volt könyvelés.</td></tr>`);
    }
    const diff = f.mtdResult - f.prevMtdResult;
    parts.push(tiles([
      ["Hó eddig eredmény", money(f.mtdResult, true), `<span style="color:${diff >= 0 ? C.green : C.red}">${diff >= 0 ? "▲" : "▼"} előző hó: ${money(f.prevMtdResult, true)}</span>`],
      ["Havi ÁFA-pozíció", money(-f.vatBalance, true), Math.abs(f.vatBalance) < 1 ? "nincs ÁFA-tétel" : f.vatBalance > 0 ? "fizetendő" : "visszaigényelhető"],
      ...(f.cashIn30 != null ? ([["30 nap múlva pénz", money(f.cashIn30), "Forecast, alap"]] as Array<[string, string, string]>) : []),
    ]));
  }

  const open = s.todos.filter((t) => t.level !== "green").length;
  const subject = `${s.name} – napi jelentés, ${short(s.date)}${open ? ` · ${open} teendő` : " · minden rendben"}`;
  const footer = `${footerText(s.name)}${appUrl() ? ` · ${link(p, "Megnyitás az ERP-ben →")}` : ""}`;
  return { subject, html: frame(s.headline, parts.join("\n"), footer), text: companyText(s, b) };
}

function companyText(s: CompanySnapshot, b: { cars: boolean; finance: boolean }): string {
  const L: string[] = [`${s.name} – napi jelentés, ${dayLabel(s.date)}`, "", s.headline, "",
    `Pénz összesen: ${money(s.kpi.cash)} · Tegnapi bevétel: ${money(s.kpi.revenueDay)}${s.kpi.stock != null ? ` · Készleten: ${s.kpi.stock} autó` : ""}`, "", "TEENDŐK"];
  for (const t of s.todos) L.push(`[${LV[t.level].hu}] ${t.text}`);
  if (b.cars && s.cars) {
    L.push("", "AUTÓKÉSZLET", `Utolsó eladás óta: ${s.cars.daysSinceSale ?? "–"} nap · Lekötött tőke: ${money(s.cars.capital)}`);
    for (const x of s.cars.top) L.push(`[${LV[x.status === "red" ? "red" : "yellow"].hu}] ${x.title} · ${x.days ?? "–"} nap ${x.note}`);
  }
  if (b.finance) {
    L.push("", "PÉNZÜGYI NAPLÓ");
    for (const e of s.finance.entries.slice(0, 8)) L.push(`${e.label} · ${money(e.amount)} · ${e.debit} / ${e.credit}`);
    L.push(`Hó eddig eredmény: ${money(s.finance.mtdResult, true)} (előző hó: ${money(s.finance.prevMtdResult, true)})`);
  }
  L.push("", footerText(s.name).replace("&amp;", "&"));
  return L.join("\n");
}

// --- holding e-mail -----------------------------------------------------------
export function renderHoldingMail(h: HoldingSnapshot): Mail {
  const T = h.totals;
  const parts: string[] = [];
  parts.push(brandRow(`Mogyorosi Holding™ · holding napi jelentés · ${dayLabel(h.date)}`));
  parts.push(headlineRow(h.headline));
  const pct = Math.abs(T.prevMtdResult) > 1 ? Math.round(((T.mtdResult - T.prevMtdResult) / Math.abs(T.prevMtdResult)) * 100) : null;
  parts.push(tiles([
    ["Pénz összesen", money(T.cash)],
    ["Hó eddig eredmény", money(T.mtdResult, true), pct != null ? `<span style="color:${pct >= 0 ? C.green : C.red}">${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)}% az előző hóhoz</span>` : ""],
    ["Év eddig eredmény", money(T.ytdResult, true)],
    ["Lekötött tőke (autók)", money(T.capital)],
  ]));

  parts.push(section("Cégenként"));
  const sig = (c: (typeof h.companies)[number]) => {
    const r = c.todos.filter((t) => t.level === "red").length, y = c.todos.filter((t) => t.level === "yellow").length;
    return r ? pill("red", String(r + y)) : y ? pill("yellow", String(y)) : pill("green", "0");
  };
  parts.push(table(
    ["Cég", "Pénz", `Bevétel ${short(h.day)}`, "Hó eddig", "Készlet", "Jelzés"],
    [
      ...h.companies.map((c) => [link(`/c/${c.companyId}`, c.name), money(c.kpi.cash), money(c.kpi.revenueDay), money(c.finance.mtdResult, true), c.kpi.stock != null ? String(c.kpi.stock) : "–", sig(c)]),
      ["Összesen", money(T.cash), money(T.revenueDay), money(T.mtdResult, true), String(T.stock), ""],
    ],
    ["30%", "15%", "15%", "15%", "11%", "14%"],
    true,
  ));

  parts.push(section("Pénz és kötelezettségek", "14 nap"));
  const coverLevel: Level = T.cover == null || T.cover >= 2 ? "green" : T.cover >= 1 ? "yellow" : "red";
  parts.push(`<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
    <td width="55%" valign="bottom" style="padding-right:12px"><div style="${F}font-size:11px;color:${C.muted};padding-bottom:4px">Holding pénzeszköz, elmúlt 30 nap</div>${spark(h.cashSeries)}</td>
    <td width="45%" valign="bottom"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr><td style="${F}font-size:12.5px;color:${C.ink};padding:3px 0">Adók, járulékok (46x)</td><td align="right" style="${F}font-size:12.5px">${money(-sumOf(h, (c) => c.extra.taxLiability), true)}</td></tr>
      <tr><td style="${F}font-size:12.5px;color:${C.ink};padding:3px 0">Szállítók 14 napon belül</td><td align="right" style="${F}font-size:12.5px">${money(-sumOf(h, (c) => c.extra.payablesDue14), true)}</td></tr>
      <tr><td style="${F}font-size:12.5px;font-weight:600;padding:3px 0;border-top:1px solid ${C.line}">Fedezettség</td><td align="right" style="${F}font-size:12.5px;font-weight:600;color:${LV[coverLevel].fg};border-top:1px solid ${C.line}">${T.cover == null ? "nincs teher" : `${nf(1).format(T.cover)}×`}</td></tr>
    </table></td></tr></table></td></tr>`);

  parts.push(section("Összes teendő"));
  parts.push(todoList(h.companies.flatMap((c) => c.todos.filter((t) => t.level !== "green").map((t) => ({ ...t, company: c.name }))).sort((a, b) => "ry".indexOf(a.level[0]) - "ry".indexOf(b.level[0]))));

  if (T.stock) {
    parts.push(section("Autók holding szinten"));
    const L = h.lanes;
    parts.push(table(["Sáv", "Autó", "Lekötött tőke", "Tartási ktg."], (["green", "yellow", "red"] as const).map((k) => [
      `${pill(k)} ${k === "green" ? "cél ár fölött" : k === "yellow" ? "cél alatt" : "beavatkozni"}`, String(L[k].count), money(L[k].capital), money(L[k].holding),
    ]), ["46%", "12%", "22%", "20%"]));
    const gaps = h.companies.filter((c) => c.cars).map((c) => `${esc(c.name)} ${c.cars!.daysSinceSale ?? "–"} nap`).join(", ");
    parts.push(`<tr><td style="${F}font-size:12px;color:${C.muted};padding:6px 0 0">${h.bestSale ? `Hó legjobb eladása: <b style="color:${C.ink}">${esc(h.bestSale.title)}</b> (${esc(h.bestSale.company)}), ${money(h.bestSale.f2)} nettó fedezet · ` : ""}Utolsó eladás óta: ${gaps}</td></tr>`);
  }

  const gh = h.companies.filter((c) => c.extra.guesthouse);
  if (T.memberLoans > 0.5 || gh.length) {
    parts.push(section("Tagi kölcsönök és vendégház"));
    const rows: string[][] = [];
    for (const c of h.companies) if (c.extra.memberLoans > 0.5) rows.push([`Tagi kölcsön egyenlege · ${esc(c.name)}`, money(c.extra.memberLoans)]);
    for (const c of gh) {
      const g = c.extra.guesthouse!;
      rows.push([`${esc(c.name)} · hó eddigi kihasználtság / következő érkezés`, `${g.occupancy != null ? `${Math.round(g.occupancy * 100)}%` : "–"} · ${g.nextStay ? short(g.nextStay) : "nincs foglalás"}`]);
    }
    parts.push(table(["", ""], rows, ["64%", "36%"]));
  }

  const open = h.companies.reduce((s, c) => s + c.todos.filter((t) => t.level !== "green").length, 0);
  const subject = `Holding napi jelentés, ${short(h.date)}${open ? ` · ${open} teendő` : " · minden rendben"}`;
  const footer = `${footerText("Holding")}${appUrl() ? ` · ${link("/", "Cégeim megnyitása →")}` : ""}`;
  const text = [`Holding napi jelentés – ${dayLabel(h.date)}`, "", h.headline, "",
    ...h.companies.map((c) => `${c.name}: pénz ${money(c.kpi.cash)}, hó eddig ${money(c.finance.mtdResult, true)}`),
    "", ...h.companies.flatMap((c) => c.todos.filter((t) => t.level !== "green").map((t) => `[${LV[t.level].hu}] ${c.name} · ${t.text}`)),
    "", footerText("Holding")].join("\n");
  return { subject, html: frame(h.headline, parts.join("\n"), footer), text };
}

const sumOf = (h: HoldingSnapshot, f: (c: HoldingSnapshot["companies"][number]) => number) => h.companies.reduce((s, c) => s + f(c), 0);
