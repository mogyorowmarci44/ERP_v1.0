/**
 * v3.6.0 – ÁNYK-motor: a NAV Általános Nyomtatványkitöltő mentett nyomtatványainak (.frm.enyk) és XML-import
 * állományainak beolvasása, valamint ÁNYK-ba importálható XML előállítása.
 *
 * Az ÁNYK minden nyomtatványnál ugyanazt a szerkezetet használja:
 *   <nyomtatvanyok xmlns="http://www.apeh.hu/abev/nyomtatvanyok/2005/01">
 *     <abev>…</abev>
 *     <nyomtatvany>                      ← lapcsoport: főlap (pl. 2665A) vagy pótlap (pl. 2665M, 2608M)
 *       <nyomtatvanyinformacio> azonosító, verzió, adózó, időszak </nyomtatvanyinformacio>
 *       <mezok><mezo eazon="0_0D0001D0084CA">178</mezo>…</mezok>
 *     </nyomtatvany>
 *   </nyomtatvanyok>
 * A mentett .frm.enyk ugyanezt egy <file><head>…</head>…</file> burokban tárolja (mentés ideje, KR-fájl neve).
 *
 * Tiszta függvények (nincs adatbázis) – tesztelhető.
 */
import { dayInfo } from "./workcal";

export const ANYK_NS = "http://www.apeh.hu/abev/nyomtatvanyok/2005/01";

export type AnykSheet = { id: string; version: string | null; fields: Record<string, string> };
export type AnykForm = {
  /** nyomtatvány-család: "2565", "2665", "2608", "2529" … (a lapjel nélkül) */
  form: string;
  name: string | null;
  templateVer: string | null;
  taxNumber: string | null;
  taxpayerName: string | null;
  from: string | null; // ISO dátum
  to: string | null;
  /** mentés ideje az ÁNYK-ban (ISO, helyi idő) – csak .enyk-nál */
  savedAt: string | null;
  /** a beküldésre előkészített KR-állomány neve – csak .enyk-nál */
  krFileName: string | null;
  sheets: AnykSheet[];
};

// --- beolvasás -----------------------------------------------------------------------------------

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const xmlDecode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()]);
export const xmlEncode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const attrs = (tag: string) => {
  const o: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = xmlDecode(m[2]);
  return o;
};
const text = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? xmlDecode(m[1].trim()) : null;
};
/** 20260901 → 2026-09-01 */
export const ymd = (s: string | null | undefined) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
/** 20261013205127463 → 2026-10-13T20:51:27 */
const stamp = (s: string | null) => (s && /^\d{14}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}` : null);
/** „2665A” → „2665”, „2608M” → „2608”, „25HIPAKA” → „25HIPAK” */
export const familyOf = (sheetId: string) => sheetId.replace(/[A-Z]$/, "");

/** Bájtok → szöveg (UTF-8, BOM nélkül; ha hibás, Windows-1250). */
export function decodeBytes(buf: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf).replace(/^﻿/, "");
  if ((utf8.match(/�/g) ?? []).length > 3) return new TextDecoder("windows-1250").decode(buf);
  return utf8;
}

/** Egy .frm.enyk vagy ÁNYK XML-import állomány beolvasása. Hibás / ismeretlen formátumnál kivételt dob. */
export function parseAnyk(xml: string): AnykForm {
  if (!xml.includes("<nyomtatvanyok")) throw new Error("Nem ÁNYK nyomtatvány (hiányzik a <nyomtatvanyok> elem).");
  const docTag = xml.match(/<docinfo\s[^>]*>/)?.[0];
  const doc = docTag ? attrs(docTag) : {};
  const root = attrs(xml.match(/<nyomtatvanyok\s[^>]*>/)?.[0] ?? "");
  const sheets: AnykSheet[] = [];
  let info: { tax: string | null; name: string | null; from: string | null; to: string | null } | null = null;
  for (const m of xml.matchAll(/<nyomtatvany(?:\s[^>]*)?>([\s\S]*?)<\/nyomtatvany>/g)) {
    const body = m[1];
    const ni = text(body, "nyomtatvanyinformacio") ?? "";
    const id = text(ni, "nyomtatvanyazonosito");
    if (!id) continue;
    const fields: Record<string, string> = {};
    for (const f of body.matchAll(/<mezo\s+eazon="([^"]+)"\s*(?:\/>|>([\s\S]*?)<\/mezo>)/g)) fields[/^0[A-Z]\d{4}/.test(f[1]) ? `0_${f[1]}` : f[1]] = xmlDecode(f[2] ?? "");
    sheets.push({ id, version: text(ni, "nyomtatvanyverzio"), fields });
    if (!info) info = { tax: text(ni, "adoszam"), name: text(ni, "nev"), from: ymd(text(ni, "tol")), to: ymd(text(ni, "ig")) };
  }
  if (!sheets.length) throw new Error("A nyomtatványban nincs egyetlen lap sem.");
  return {
    form: doc.id || root.id || familyOf(sheets[0].id),
    name: doc.name || root.name || null,
    templateVer: doc.templatever || sheets[0].version,
    taxNumber: doc.tax_number || info?.tax || null,
    taxpayerName: doc.person_name || info?.name || null,
    from: ymd(doc.from_date) ?? info?.from ?? null,
    to: ymd(doc.to_date) ?? info?.to ?? null,
    savedAt: stamp(text(xml, "saved")),
    krFileName: doc.krfilename || null,
    sheets,
  };
}

// --- XML előállítás --------------------------------------------------------------------------------

export type BuildInput = {
  taxNumber: string; taxpayerName: string; from: string; to: string;
  sheets: Array<{ id: string; version?: string | null; fields: Record<string, string | number | null | undefined> }>;
  programVersion?: string;
};

/** Az ÁNYK aktuális sablonverziója nyomtatványcsaládonként (a mentett .frm.enyk-hoz). */
export const TEMPLATE_VER: Record<string, string> = { "2565": "4.0", "2665": "2.0" };

/**
 * ÁNYK-mentés (.frm.enyk) – ugyanaz a formátum, amit az ÁNYK maga ment. Az abevjava „mentesek” mappájába másolva a
 * Nyomtatvány megnyitása listából nyitható, és (az importált XML-lel szemben) megjelölhető elektronikus beküldésre.
 * A mezőkódok itt az ÁNYK belső alakjában maradnak („0_…”, dinamikus lapnál „n_0BXXXX…”).
 * calculated="true": betöltéskor az ÁNYK nem számolja újra a számított mezőket (pl. 105. sor b, „Partnerek száma M”) –
 * a saját rejtett segédmezői nélkül 0-ra/üresre írná őket, a mi értékeink viszont helyesek.
 */
export function buildAnykEnyk(b: BuildInput & { form: string; templateVer?: string; programVersion?: string }): string {
  const d8 = (iso: string) => iso.replace(/-/g, "");
  const tax = b.taxNumber.replace(/\D/g, "").slice(0, 11);
  const tv = b.templateVer ?? TEMPLATE_VER[b.form] ?? "1.0";
  const pv = b.programVersion ?? "v.3.49.0";
  const name = `${b.form} kötegelt nyomtatvány`;
  const now = new Date();
  const saved = now.toISOString().replace(/\D/g, "").slice(0, 17);
  const a = (v: string) => xmlEncode(v);
  const out: string[] = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<file>`,
    `  <head filetype="zn1810">`,
    `    <type>multi</type>`,
    `    <saved>${saved}</saved>`,
    `    <docinfo name="${a(name)}" id="${a(b.form)}" count="${b.sheets.length}" note="" ver="${a(pv)}" org="NAV" templatever="${a(tv)}" tax_number="${tax}" from_date="${d8(b.from)}" to_date="${d8(b.to)}" person_name="${a(b.taxpayerName)}" account_name="" calculated="true" seq="${b.sheets.length}" avdh_cst="" />`,
    `  </head>`,
    `  <nyomtatvanyok xmlns="${ANYK_NS}" template="NAV_${a(b.form)}_${tv.replace(".", "_")}" name="${a(name)}" id="${a(b.form)}">`,
    `    <abev>`,
    `      <hibakszama>-1</hibakszama>`,
    `      <hash>${" ".repeat(40)}</hash>`,
    `      <programverzio>${a(pv)}</programverzio>`,
    `    </abev>`,
  ];
  b.sheets.forEach((s, sn) => {
    out.push(
      `    <nyomtatvany sn="${sn}">`,
      `      <nyomtatvanyinformacio>`,
      `        <nyomtatvanyazonosito>${a(s.id)}</nyomtatvanyazonosito>`,
      `        <nyomtatvanyverzio>${a(tv)}</nyomtatvanyverzio>`,
      `        <adozo>`,
      `          <nev>${a(b.taxpayerName)}</nev>`,
      `          <adoszam>${tax}</adoszam>`,
      `        </adozo>`,
      ...albizonylat(s).map((l) => "  " + l),
      `        <idoszak>`,
      `          <tol>${d8(b.from)}</tol>`,
      `          <ig>${d8(b.to)}</ig>`,
      `        </idoszak>`,
      `      </nyomtatvanyinformacio>`,
      `      <mezok>`,
    );
    for (const k of Object.keys(s.fields).sort()) {
      const v = s.fields[k];
      if (v === null || v === undefined || v === "") continue;
      out.push(`        <mezo eazon="${a(k)}">${a(String(v))}</mezo>`);
    }
    out.push(`      </mezok>`, `    </nyomtatvany>`);
  });
  out.push(`  </nyomtatvanyok>`, `</file>`, ``);
  return out.join("\n");
}

/** Alnyomtatvány (pl. 2665M) azonosítása: partner adószáma és neve – nélküle az ÁNYK nem rendeli a laphoz. */
function albizonylat(s: BuildInput["sheets"][number]): string[] {
  if (!/M$/.test(s.id)) return [];
  const id = s.fields["0_0A0001C005A"], name = s.fields["0_0A0001C006A"];
  if (!id && !name) return [];
  return [
    `      <albizonylatazonositas>`,
    `        <megnevezes>${xmlEncode(String(name ?? ""))}</megnevezes>`,
    `        <azonosito>${xmlEncode(String(id ?? ""))}</azonosito>`,
    `      </albizonylatazonositas>`,
  ];
}

/** ÁNYK-ba importálható XML (Adatok › Import / XML állomány). A mezők eazon szerint rendezve, üres értékek nélkül. */
export function buildAnykXml(b: BuildInput): string {
  const d8 = (iso: string) => iso.replace(/-/g, "");
  const tax = b.taxNumber.replace(/\D/g, "").slice(0, 11);
  const out: string[] = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<nyomtatvanyok xmlns="${ANYK_NS}">`,
    `  <abev>`,
    `    <hibakszama>0</hibakszama>`,
    `    <hash></hash>`,
    `    <programverzio>${xmlEncode(b.programVersion ?? "mogyorosi.erp")}</programverzio>`,
    `  </abev>`,
  ];
  for (const s of b.sheets) {
    out.push(
      `  <nyomtatvany>`,
      `    <nyomtatvanyinformacio>`,
      `      <nyomtatvanyazonosito>${xmlEncode(s.id)}</nyomtatvanyazonosito>`,
      // sablonverzió nélkül az ÁNYK „nincs meg az eredeti verziójú sablon” kérdéssel nyitja meg
      ...((s.version ?? TEMPLATE_VER[s.id.replace(/[A-Z]$/, "")]) ? [`      <nyomtatvanyverzio>${xmlEncode(s.version ?? TEMPLATE_VER[s.id.replace(/[A-Z]$/, "")])}</nyomtatvanyverzio>`] : []),
      `      <adozo>`,
      `        <nev>${xmlEncode(b.taxpayerName)}</nev>`,
      `        <adoszam>${tax}</adoszam>`,
      `      </adozo>`,
      ...albizonylat(s),
      `      <idoszak>`,
      `        <tol>${d8(b.from)}</tol>`,
      `        <ig>${d8(b.to)}</ig>`,
      `      </idoszak>`,
      `    </nyomtatvanyinformacio>`,
      `    <mezok>`,
    );
    for (const k of Object.keys(s.fields).sort()) {
      const v = s.fields[k];
      if (v === null || v === undefined || v === "") continue;
      out.push(`      <mezo eazon="${xmlEncode(importEazon(k))}">${xmlEncode(String(v))}</mezo>`);
    }
    out.push(`    </mezok>`, `  </nyomtatvany>`);
  }
  out.push(`</nyomtatvanyok>`, ``);
  return out.join("\n");
}

/**
 * Mezőkód az importálható XML-be. Az ÁNYK mentésében (.enyk) a kód „n_EAZON”, ahol n a lap 0-tól számolt példánya és a
 * dinamikus lapok kódjában „XXXX” áll. Az import-XML-ben nincs „n_” előtag, a dinamikus lapnál pedig az XXXX helyére a
 * lap sorszáma kerül: „1_0BXXXXC0001AA” → „0B0002C0001AA”, „0_0A0001C001A” → „0A0001C001A”.
 */
export function importEazon(k: string) {
  const m = k.match(/^(\d+)_(0[A-Z])XXXX(.+)$/);
  if (m) return `${m[2]}${String(Number(m[1]) + 1).padStart(4, "0")}${m[3]}`;
  return k.replace(/^\d+_(?=0[A-Z]\d{4})/, "");
}

// --- bevallás-jelleg, ÁFA eredménysorok ------------------------------------------------------------

export type FilingKind = "original" | "self_revision" | "correction";
export const KIND_LABEL: Record<FilingKind, string> = { original: "eredeti", self_revision: "önellenőrzés", correction: "helyesbítés" };

/** A 65-ös ÁFA-bevallás főlapján: A bevallás jellege (O = önellenőrzés, H = helyesbítés, üres = eredeti). */
export const VAT_KIND_FIELD = "0_0A0001F005A";

/** ÁFA-bevallás (2565/2665) eredménysorai a főlap D/C oszlopában, ezer Ft-ban. */
export const VAT_RESULT_ROWS = {
  prevCarry: "0_0D0001D0082CA", // 82. előző időszakról átvitt követelés
  diff: "0_0D0001D0083CA",      // 83. a tárgyidőszak befizetendő / visszaigényelhető különbözete
  payable: "0_0D0001D0084CA",   // 84. befizetendő adó
  refund: "0_0D0001D0085CA",    // 85. visszaigényelt adó
  carry: "0_0D0001D0086CA",     // 86. következő időszakra átvihető követelés
} as const;
export type VatResult = { prevCarry: number | null; diff: number | null; payable: number | null; refund: number | null; carry: number | null };

export const isVatForm = (form: string) => /^\d\d65$/.test(form);
export const isPayrollForm = (form: string) => /^\d\d08$/.test(form);

const num = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : Number(v.replace(/\s/g, "").replace(",", ".")));

export function kindOf(f: Pick<AnykForm, "form" | "sheets">): FilingKind {
  const main = f.sheets[0]?.fields ?? {};
  if (isVatForm(f.form)) {
    const v = (main[VAT_KIND_FIELD] ?? "").toUpperCase();
    return v === "O" ? "self_revision" : v === "H" ? "correction" : "original";
  }
  // a többi nyomtatványnál: bármely főlapmező „O” / „H” jelöléssel a „jelleg” mezőben – amíg nincs pontos mezőkód, eredeti
  return "original";
}

export function vatResult(f: Pick<AnykForm, "sheets">): VatResult {
  const m = f.sheets[0]?.fields ?? {};
  const g = (k: string) => num(m[k]);
  return { prevCarry: g(VAT_RESULT_ROWS.prevCarry), diff: g(VAT_RESULT_ROWS.diff), payable: g(VAT_RESULT_ROWS.payable), refund: g(VAT_RESULT_ROWS.refund), carry: g(VAT_RESULT_ROWS.carry) };
}

/** Rövid összefoglaló a listákhoz: lapok száma, ÁFA-eredmény, bevallás jellege, aláírás dátuma. */
export function summarize(f: AnykForm) {
  const main = f.sheets[0]?.fields ?? {};
  const counts: Record<string, number> = {};
  for (const s of f.sheets) counts[s.id] = (counts[s.id] ?? 0) + 1;
  return {
    kind: kindOf(f),
    sheetCounts: counts,
    signedAt: isVatForm(f.form) ? ymd(main["0_0A0001I002A"]) : null,
    vat: isVatForm(f.form) ? vatResult(f) : null,
  };
}

/** Adószám-összevetés: az első 8 jegy (törzsszám) egyezzen. */
export const sameTaxpayer = (a: string | null | undefined, b: string | null | undefined) => {
  const x = (a ?? "").replace(/\D/g, "").slice(0, 8), y = (b ?? "").replace(/\D/g, "").slice(0, 8);
  return x.length === 8 && x === y;
};

// --- átviteli lánc ----------------------------------------------------------------------------------

export type ChainIssue = { period: string; expected: number; found: number | null; prevPeriod: string };

/**
 * ÁFA átviteli lánc: ha az előző hónap 86. sorában átvihető követelés van, annak a következő hónap 82. sorában
 * meg kell jelennie. A bemenet időszakonként a mérvadó (beküldött / legutolsó) változat, időrendben.
 */
export function vatChainIssues(rows: Array<{ period: string; vat: VatResult | null }>): ChainIssue[] {
  const out: ChainIssue[] = [];
  const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], cur = sorted[i];
    if (!prev.vat || !cur.vat || !isNextMonth(prev.period, cur.period)) continue;
    const carry = prev.vat.carry ?? 0;
    const got = cur.vat.prevCarry ?? 0;
    if (carry !== got) out.push({ period: cur.period, expected: carry, found: cur.vat.prevCarry, prevPeriod: prev.period });
  }
  return out;
}

// --- időszakok, határidők ---------------------------------------------------------------------------

export const periodOf = (isoDate: string) => isoDate.slice(0, 7);
export function isNextMonth(a: string, b: string) {
  const [y, m] = a.split("-").map(Number);
  const n = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return n === b;
}
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Ha a határidő munkaszüneti / pihenőnapra esik, a következő munkanap (Art. 10. §). */
export function nextWorkday(iso: string) {
  let d = iso;
  for (let i = 0; i < 10 && dayInfo(d).type !== "work"; i++) {
    const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); d = t.toISOString().slice(0, 10);
  }
  return d;
}
/** Havi bevallás határideje a tárgyhót követő hó adott napja: ÁFA (65) 20., járulék (08) 12. */
export function dueDate(form: string, period: string) {
  const [y, m] = period.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const day = isPayrollForm(form) ? 12 : 20;
  return nextWorkday(`${ny}-${String(nm).padStart(2, "0")}-${day}`);
}

/** A nyomtatvány-családhoz tartozó év (2565 → 2025, 2665 → 2026). */
export const formYear = (form: string) => 2000 + Number(form.slice(0, 2));
/** Melyik nyomtatvány kell egy időszakra: ÁFA 2025 → 2565, 2026 → 2665; járulék 2026 → 2608. */
export const formFor = (type: "vat" | "payroll", period: string) => `${period.slice(2, 4)}${type === "vat" ? "65" : "08"}`;
