/**
 * v3.3.3 – A Kincstár HAKKA (hakka.allamkincstar.gov.hu) országos havi adatállományának feldolgozása HIPA-szabályokká.
 * A fájl formátumát a Kincstár határozza meg (zip / xlsx / xls / csv / xml) – a feldolgozó ezért rugalmas:
 * minden táblázatban megkeresi az önkormányzat nevét, az adónemet, a mértéket és a mentesség szövegét, és
 * diagnosztikát ad vissza (fájlok, munkalapok, fejlécek), hogy formátumváltozásnál látszódjon, mi érkezett.
 * Tiszta függvények (nincs adatbázis) – tesztelhető.
 */
import { unzipSync } from "fflate";
import * as XLSX from "xlsx";
import { HIPA_EXEMPT_MAX, HIPA_RATE_MAX, type HipaRule } from "./corp-tax";

type Row = Record<string, string>;
type Table = { name: string; rows: Row[]; headers: string[] };

const decode = (buf: Uint8Array): string => {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  // ha sok a cserekarakter, valószínűleg Windows-1250 (magyar Excel CSV)
  if ((utf8.match(/�/g) ?? []).length > 3) return new TextDecoder("windows-1250").decode(buf);
  return utf8.replace(/^﻿/, "");
};

/** Egyszerű XML → rekordok: a leggyakoribb, gyermek-elemeket tartalmazó elem lesz a „sor”. */
function xmlTables(name: string, text: string): Table[] {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/<([A-Za-z_][\w.:-]*)[^>]*>\s*<[A-Za-z_]/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  const rowTag = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!rowTag) return [];
  const rows: Row[] = [];
  const re = new RegExp(`<${rowTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${rowTag}>`, "g");
  for (const m of text.matchAll(re)) {
    const row: Row = {};
    for (const c of m[1].matchAll(/<([A-Za-z_][\w.:-]*)[^>]*>([^<]*)<\/\1>/g)) row[c[1]] = unescapeXml(c[2]).trim();
    if (Object.keys(row).length) rows.push(row);
  }
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [{ name: `${name} (<${rowTag}>)`, rows, headers }];
}
const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Táblázat (xlsx/xls/csv) → sorok; a fejléc az első olyan sor, amelyben legalább 3 szöveges cella van. */
function sheetTables(name: string, buf: Uint8Array, isText: boolean): Table[] {
  const wb = isText ? XLSX.read(decode(buf), { type: "string", raw: true }) : XLSX.read(buf, { type: "array", cellDates: false });
  return wb.SheetNames.map((sn) => {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, raw: false, defval: "" }) as unknown[][];
    let h = aoa.findIndex((r) => r.filter((c) => typeof c === "string" && /[a-záéíóöőúüű]{3,}/i.test(c)).length >= 3);
    if (h < 0) h = 0;
    const headers = (aoa[h] ?? []).map((c, i) => String(c || `oszlop${i + 1}`).trim());
    const rows = aoa.slice(h + 1).filter((r) => r.some((c) => String(c).trim())).map((r) => Object.fromEntries(headers.map((k, i) => [k, String(r[i] ?? "").trim()])));
    return { name: `${name} › ${sn}`, rows, headers };
  });
}

export function filesToTables(files: { name: string; data: Uint8Array }[], diag: string[]): Table[] {
  const out: Table[] = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    try {
      if (lower.endsWith(".zip") || (f.data[0] === 0x50 && f.data[1] === 0x4b && !/\.(xlsx|xlsm)$/.test(lower))) {
        const inner = unzipSync(f.data);
        const entries = Object.entries(inner).filter(([n, d]) => !n.endsWith("/") && d.length);
        diag.push(`${f.name}: zip, ${entries.length} fájl (${entries.map(([n]) => n).slice(0, 12).join(", ")})`);
        out.push(...filesToTables(entries.map(([n, d]) => ({ name: n, data: d })), diag));
      } else if (lower.endsWith(".xml")) {
        const t = xmlTables(f.name, decode(f.data));
        diag.push(`${f.name}: xml, ${t[0]?.rows.length ?? 0} rekord`);
        out.push(...t);
      } else if (/\.(csv|txt)$/.test(lower)) {
        out.push(...sheetTables(f.name, f.data, true));
      } else if (/\.(xlsx|xlsm|xls|ods)$/.test(lower) || f.data[0] === 0xd0) {
        out.push(...sheetTables(f.name, f.data, false));
      } else {
        diag.push(`${f.name}: ismeretlen formátum, kihagyva (${f.data.length} bájt)`);
      }
    } catch (e) {
      diag.push(`${f.name}: nem olvasható – ${(e as Error).message}`);
    }
  }
  return out;
}

// --- Értelmezés -------------------------------------------------------------------------

const pick = (headers: string[], re: RegExp) => headers.find((h) => re.test(h.toLocaleLowerCase("hu-HU")));

/** Forintösszegek a szövegben: csak „Ft” / „forint” / „millió” jelzésű számok (azonosítók, dátumok kizárva). */
export function hufAmounts(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*milli[oó]/gi)) out.push(Math.round(Number(m[1].replace(",", ".")) * 1_000_000));
  for (const m of s.matchAll(/(\d{1,3}(?:[ .\u00a0]\d{3})+|\d{4,})\s*(?:,-)?\s*(?:-?\s*)?(?:ft|forint)/gi)) out.push(Number(m[1].replace(/[ .\u00a0]/g, "")));
  return out;
}

/** Adóalap-mentességi határ a szövegből (Htv. 39/C. § (2)) – háziorvos / védőnő mentességet kihagyva. */
export function parseExemption(text: string): { below: number; inclusive: boolean } | null {
  const t = text.toLocaleLowerCase("hu-HU").replace(/\s+/g, " ");
  if (/háziorvos|védőnő/.test(t)) return null;
  if (!/adóalap/.test(t)) return null;
  const exclusive = /nem éri el|nem érte el|kisebb mint|kisebb,? mint|kevesebb mint|alatti?\b/.test(t);
  const inclusive = !exclusive && /nem haladja meg|nem haladta meg|legfeljebb|nem több mint/.test(t);
  if (!inclusive && !exclusive) return null;
  const amounts = hufAmounts(t).filter((n) => n >= 10_000 && n <= HIPA_EXEMPT_MAX);
  if (!amounts.length) return null;
  return { below: Math.max(...amounts), inclusive };
}

/** Mérték: „2”, „2%”, „2,0 %”, „0,02” → 0.02; Ft/nap (ideiglenes) → null. */
export function parseRate(s: string): number | null {
  const t = s.toLowerCase();
  if (/ft|nap|forint/.test(t)) return null;
  const m = t.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  let v = Number(m[1].replace(",", "."));
  if (v > 1) v = v / 100;
  return v > 0 && v <= HIPA_RATE_MAX + 1e-9 ? Math.round(v * 10000) / 10000 : null;
}

export type ParseResult = { rules: Record<string, HipaRule>; diagnostics: string[]; withExemption: number };

/**
 * Táblák → HIPA-szabályok településenként. `norm` a névnormalizáló (a hipa-rules modulból).
 * Csak az állandó jellegű iparűzési tevékenységre vonatkozó sorokat veszi figyelembe.
 */
export function tablesToRules(tables: Table[], norm: (s: string) => string, sourceLabel: string, diag: string[]): ParseResult {
  const rules: Record<string, HipaRule> = {};
  let used = 0;
  for (const t of tables) {
    const nameCol = pick(t.headers, /(önkormányzat|onk).*(n[eé]v|nev)|telep[uü]l[eé]s|^n[eé]v$|^(önkormányzat|onkormanyzat)$|helys[eé]g|^megnevez[eé]s$/)
      ?? pick(t.headers, /önkormányzat|onkormanyzat|n[eé]v\b/);
    const rateCol = pick(t.headers, /m[eé]rt[eé]k|kulcs|%/);
    const typeCol = pick(t.headers, /ad[oó] ?nem|ad[oó] ?fajt|ad[oó] ?megnev|ad[oó]$|t[ií]pus/);
    diag.push(`${t.name}: ${t.rows.length} sor · fejlécek: ${t.headers.slice(0, 18).join(" | ")}${t.headers.length > 18 ? " …" : ""}`);
    if (!nameCol) { diag.push(`  ↳ nincs önkormányzat-név oszlop, kihagyva`); continue; }
    let n = 0;
    for (const r of t.rows) {
      const all = Object.values(r).join(" · ");
      const low = all.toLocaleLowerCase("hu-HU");
      const isHipa = typeCol ? /iparűzési|ipa\b|hipa/.test((r[typeCol] ?? "").toLocaleLowerCase("hu-HU")) || /iparűzési/.test(low) : /iparűzési/.test(low);
      if (!isHipa || /ideiglenes/.test(low)) continue;
      const name = (r[nameCol] ?? "").trim();
      if (!name) continue;
      const key = norm(name);
      if (!key) continue;
      const rule = (rules[key] ??= { name: name.replace(/\s+(város|község|nagyközség)?\s*önkormányzat(a)?.*$/i, "").trim() || name, rate: HIPA_RATE_MAX, exemptBelow: null, exemptInclusive: false, notes: [], source: sourceLabel });
      const rate = rateCol ? parseRate(r[rateCol] ?? "") : null;
      if (rate != null && !/kedvezm|mentes/.test(low)) rule.rate = rate;
      const ex = parseExemption(all);
      if (ex && (rule.exemptBelow == null || ex.below > rule.exemptBelow)) { rule.exemptBelow = ex.below; rule.exemptInclusive = ex.inclusive; }
      if (/mentes|kedvezm/.test(low) && rule.notes!.length < 6) {
        const note = all.replace(/\s*·\s*/g, " · ").slice(0, 400);
        if (!rule.notes!.includes(note)) rule.notes!.push(note);
      }
      n++;
    }
    used += n;
    diag.push(`  ↳ ${n} iparűzési adó sor (név: „${nameCol}”${rateCol ? `, mérték: „${rateCol}”` : ""}${typeCol ? `, adónem: „${typeCol}”` : ""})`);
  }
  const list = Object.values(rules);
  diag.push(`Összesen ${used} sor → ${list.length} önkormányzat, ebből ${list.filter((r) => r.exemptBelow != null).length} adóalap-mentességgel.`);
  return { rules, diagnostics: diag, withExemption: list.filter((r) => r.exemptBelow != null).length };
}

export function parseHakkaFiles(files: { name: string; data: Uint8Array }[], norm: (s: string) => string, sourceLabel: string): ParseResult {
  const diag: string[] = [];
  const tables = filesToTables(files, diag);
  return tablesToRules(tables, norm, sourceLabel, diag);
}
