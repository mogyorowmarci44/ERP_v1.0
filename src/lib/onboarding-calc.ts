/**
 * v6.5.0 – Bevezetés új cégnél: táblázatos importok értelmezése (tiszta függvények, tesztelhetők).
 * A fejléceket rugalmasan ismeri fel (kis-/nagybetű, ékezet, szóköz nem számít), az összegeket magyar és angol
 * írásmóddal is (1 234 567,89 · 1,234,567.89 · -1234).
 */
export type Row = Record<string, unknown>;

export const normHeader = (s: string) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

const ALIASES: Record<string, string[]> = {
  code: ["szamla", "szamlaszam", "fokonyviszamla", "fokonyvi", "kod", "account", "code"],
  name: ["megnevezes", "nev", "szamlanev", "name", "description"],
  debit: ["tartozik", "t", "debit", "tartozikegyenleg"],
  credit: ["kovetel", "k", "credit", "kovetelegyenleg"],
  balance: ["egyenleg", "balance", "zaroegyenleg", "nyitoegyenleg"],
  partner: ["partner", "partnernev", "vevoszallito"],
  amountFx: ["devizaosszeg", "deviza", "amountfx"],
  type: ["tipus", "type"],
  taxNumber: ["adoszam", "taxnumber"],
  euVatNumber: ["kozossegiadoszam", "euadoszam", "euvat", "vatnumber"],
  country: ["orszag", "orszagkod", "country"],
  address: ["cim", "address", "szekhely"],
  email: ["email", "emailcim"],
  isPrivatePerson: ["maganszemely", "private", "privateperson"],
};

/** Egy sor mezőjének értéke a lehetséges fejlécnevek alapján. */
export function field(row: Row, key: keyof typeof ALIASES): unknown {
  const want = new Set(ALIASES[key]);
  for (const [k, v] of Object.entries(row)) if (want.has(normHeader(k))) return v;
  return undefined;
}

export const text = (v: unknown) => (v == null ? "" : typeof v === "object" && v && "text" in v ? String((v as { text: unknown }).text) : String(v)).trim();

/** Szám magyar / angol írásmódban; üres → 0; értelmezhetetlen → NaN. */
export function amount(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v && "result" in v) return amount((v as { result: unknown }).result);
  let s = String(v).trim().replace(/\s| |Ft|HUF/gi, "");
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{3}$/.test(s) && !/,\d{1,2}$/.test(s) && s.split(",").length > 2 ? s.replace(/,/g, "") : s.replace(",", ".");
  const n = Number(s);
  return neg ? -n : n;
}

const truthy = (v: unknown) => /^(1|igen|i|x|true|yes|y)$/i.test(text(v));

/** Magyar számlatükör: a számlaszám első jegye(i) alapján a típus. */
export function accountTypeOf(code: string): "asset" | "liability" | "equity" | "expense" | "revenue" | "off_balance" {
  const c = code.trim();
  if (c.startsWith("0")) return "off_balance";
  if (/^[123]/.test(c)) return "asset";
  if (/^4[123]/.test(c)) return "equity";
  if (c.startsWith("4")) return "liability";
  if (/^[5-8]/.test(c)) return "expense";
  return "revenue";
}

export type OpeningLine = { row: number; code: string; name: string; debit: number; credit: number; partner: string; amountFx: number | null };
export type ParseResult<T> = { items: T[]; errors: string[] };

/** Nyitómérleg / főkönyvi kivonat: Számla, Megnevezés, Tartozik, Követel (vagy Egyenleg), opcionálisan Partner, Devizaösszeg. */
export function parseOpening(rows: Row[]): ParseResult<OpeningLine> & { totalDebit: number; totalCredit: number } {
  const items: OpeningLine[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const n = i + 2; // fejléc az 1. sor
    const code = text(field(r, "code")).replace(/\s/g, "");
    if (!code) return; // üres / összesítő sor
    if (!/^\d{1,12}$/.test(code)) { errors.push(`${n}. sor: a „${code}” nem főkönyvi számlaszám.`); return; }
    let debit = amount(field(r, "debit"));
    let credit = amount(field(r, "credit"));
    const bal = field(r, "balance");
    if (bal !== undefined && !debit && !credit) {
      const b = amount(bal);
      if (b >= 0) debit = b; else credit = -b;
    }
    if (Number.isNaN(debit) || Number.isNaN(credit)) { errors.push(`${n}. sor (${code}): az összeg nem értelmezhető.`); return; }
    // negatív összeg a másik oldalra
    if (debit < 0) { credit += -debit; debit = 0; }
    if (credit < 0) { debit += -credit; credit = 0; }
    const net = Math.round((debit - credit) * 100) / 100;
    if (net === 0) return;
    const fx = field(r, "amountFx");
    items.push({ row: n, code, name: text(field(r, "name")), debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, partner: text(field(r, "partner")), amountFx: fx === undefined || text(fx) === "" ? null : Math.abs(amount(fx)) });
  });
  const totalDebit = Math.round(items.reduce((s, l) => s + l.debit, 0) * 100) / 100;
  const totalCredit = Math.round(items.reduce((s, l) => s + l.credit, 0) * 100) / 100;
  if (!items.length && !errors.length) errors.push("Nem találtam tételt – ellenőrizd a fejlécet (Számla, Megnevezés, Tartozik, Követel).");
  if (Math.abs(totalDebit - totalCredit) >= 0.01) errors.push(`A nyitómérleg nem egyezik: Tartozik ${totalDebit.toLocaleString("hu-HU")} ≠ Követel ${totalCredit.toLocaleString("hu-HU")} (különbözet: ${(totalDebit - totalCredit).toLocaleString("hu-HU")}).`);
  return { items, errors, totalDebit, totalCredit };
}

export type AccountRow = { row: number; code: string; name: string; type: ReturnType<typeof accountTypeOf> };

/** Számlatükör: Számla, Megnevezés, (Típus: eszköz/kötelezettség/saját tőke/költség/bevétel). */
export function parseAccounts(rows: Row[]): ParseResult<AccountRow> {
  const items: AccountRow[] = [];
  const errors: string[] = [];
  const TYPES: Record<string, AccountRow["type"]> = { eszkoz: "asset", kotelezettseg: "liability", sajattoke: "equity", koltseg: "expense", raforditas: "expense", bevetel: "revenue", nyilvantartasi: "off_balance" };
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const n = i + 2;
    const code = text(field(r, "code")).replace(/\s/g, "");
    if (!code) return;
    if (!/^\d{1,12}$/.test(code)) { errors.push(`${n}. sor: a „${code}” nem számlaszám.`); return; }
    const name = text(field(r, "name"));
    if (!name) { errors.push(`${n}. sor (${code}): hiányzik a megnevezés.`); return; }
    if (seen.has(code)) { errors.push(`${n}. sor: a ${code} kétszer szerepel.`); return; }
    seen.add(code);
    const t = TYPES[normHeader(text(field(r, "type")))];
    items.push({ row: n, code, name, type: t ?? accountTypeOf(code) });
  });
  return { items, errors };
}

export type PartnerRow = { row: number; name: string; taxNumber: string; euVatNumber: string; country: string; address: string; email: string; isPrivatePerson: boolean };

/** Partnerek: Név, Adószám, Közösségi adószám, Ország, Cím, E-mail, Magánszemély (igen/nem). */
export function parsePartners(rows: Row[]): ParseResult<PartnerRow> {
  const items: PartnerRow[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const name = text(field(r, "name") ?? field(r, "partner"));
    if (!name) return;
    items.push({
      row: i + 2, name, taxNumber: text(field(r, "taxNumber")), euVatNumber: text(field(r, "euVatNumber")),
      country: text(field(r, "country")) || "HU", address: text(field(r, "address")), email: text(field(r, "email")), isPrivatePerson: truthy(field(r, "isPrivatePerson")),
    });
  });
  if (!items.length) errors.push("Nem találtam partnert – ellenőrizd a fejlécet (Név, Adószám, …).");
  return { items, errors };
}

/** CSV (pontosvessző, vessző vagy tabulátor; idézőjeles mezők) → sorok a fejléc szerint. */
export function parseCsv(textIn: string): Row[] {
  const src = textIn.replace(/^﻿/, "");
  const first = src.split(/\r?\n/)[0] ?? "";
  const delim = [";", "\t", ","].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cur); out.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  const [head, ...rest] = out.filter((r) => r.some((x) => x.trim() !== ""));
  if (!head) return [];
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])));
}
