/**
 * v6.10.0 – Számlázóprogram-integráció (számlázz.hu, Billingo): a kiállított számlák
 * átalakítása a Beérkező bizonylatok kiolvasott formájára. Tiszta függvények, tesztelhetők.
 */
import { XMLParser } from "fast-xml-parser";
import type { ExtractedDoc } from "@/db/schema";

type Line = NonNullable<ExtractedDoc["lines"]>[number];
type Party = NonNullable<ExtractedDoc["buyer"]>;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(typeof v === "object" ? "" : v).trim();
  return t || null;
};
const date = (v: unknown): string | null => {
  const t = s(v);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};
const arr = <T>(v: T | T[] | null | undefined): T[] => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** ÁFA-kulcs a számlázóprogramból: szám (27, „27%”) → kulcs; betűkód (AAM, TAM, K.AFA, EUFAD37…) → típus. */
export function vatOf(raw: unknown): { vatRate: number | null; vatType: string | null } {
  const t = (s(raw) ?? "").toUpperCase().replace(/\s/g, "");
  const m = /^(\d+(?:[.,]\d+)?)%?$/.exec(t);
  if (m) return { vatRate: Number(m[1].replace(",", ".")), vatType: null };
  if (!t) return { vatRate: null, vatType: null };
  // fordított adózás (belföldi / EU) → FAD; különbözeti → K.AFA
  if (/^(EUFAD|FAD|F\.?AFA|EUFADE)/.test(t)) return { vatRate: 0, vatType: "FAD" };
  return { vatRate: 0, vatType: t };
}

export function paymentOf(raw: unknown): ExtractedDoc["paymentMethod"] {
  const t = (s(raw) ?? "").toLowerCase();
  if (!t) return null;
  if (/k[ée]szp[ée]nz|cash|utánvét|utanvet/.test(t)) return "cash";
  if (/k[áa]rty|card|bankcard|paypal|szép|szep/.test(t)) return "card";
  return "transfer";
}

// ---------------------------------------------------------------------------
// Számlázz.hu – Számla Agent XML (action-szamla_agent_xml)
// ---------------------------------------------------------------------------

/** A lekérdező XML (csak a Számla Agent kulccsal, felhasználónév/jelszó nélkül). */
export function szamlazzQueryXml(agentKey: string, invoiceNumber: string, withPdf = true): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlaxml xmlns="http://www.szamlazz.hu/xmlszamlaxml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlaxml https://www.szamlazz.hu/szamla/docs/xsds/agentxml/xmlszamlaxml.xsd">
  <szamlaagentkulcs>${esc(agentKey)}</szamlaagentkulcs>
  <szamlaszam>${esc(invoiceNumber)}</szamlaszam>
  <pdf>${withPdf ? "true" : "false"}</pdf>
</xmlszamlaxml>`;
}

export type SzamlazzResult =
  | { kind: "ok"; extracted: ExtractedDoc; pdf: string | null }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, removeNSPrefix: true });

/** A számlázz.hu válaszának értelmezése (számla adatai + PDF, vagy hibakód). */
export function parseSzamlazzResponse(xml: string): SzamlazzResult {
  let doc: Record<string, unknown>;
  try { doc = parser.parse(xml) as Record<string, unknown>; } catch { return { kind: "error", message: "A számlázz.hu válasza nem értelmezhető." }; }
  const err = (doc.xmlszamlavalasz ?? doc.xmlszamlaxmlvalasz) as Record<string, unknown> | undefined;
  if (err) {
    const code = s(err.hibakod);
    if (code === "7" || /nem (található|létezik)|not found/i.test(s(err.hibauzenet) ?? "")) return { kind: "notFound" };
    return { kind: "error", message: `számlázz.hu hiba${code ? ` (${code})` : ""}: ${s(err.hibauzenet) ?? "ismeretlen"}` };
  }
  const sz = doc.szamla as Record<string, unknown> | undefined;
  if (!sz) return { kind: "error", message: "A számlázz.hu válaszában nincs számla." };
  return { kind: "ok", extracted: fromSzamlazz(sz), pdf: s(sz.pdf) };
}

export function fromSzamlazz(sz: Record<string, unknown>): ExtractedDoc {
  const alap = (sz.alap ?? {}) as Record<string, unknown>;
  const vevo = (sz.vevo ?? {}) as Record<string, unknown>;
  const szall = (sz.szallito ?? {}) as Record<string, unknown>;
  const tetelek = arr(((sz.tetelek ?? {}) as Record<string, unknown>).tetel as Record<string, unknown> | Record<string, unknown>[]);
  const ossz = (((sz.osszegek ?? {}) as Record<string, unknown>).totalossz ?? {}) as Record<string, unknown>;
  const addr = (c: unknown) => {
    const a = (c ?? {}) as Record<string, unknown>;
    return [s(a.irsz), s(a.telepules), s(a.cim)].filter(Boolean).join(" ") || null;
  };
  const tipus = (s(alap.tipus) ?? "").toUpperCase();
  const lines: Line[] = tetelek.map((t) => ({
    description: s(t.nev) ?? "Tétel",
    quantity: num(t.mennyiseg),
    unitNet: num(t.nettoegysegar),
    net: num(t.netto) ?? 0,
    ...vatOf(t.afakulcs),
    vat: num(t.afa),
    gross: num(t.brutto),
  }));
  const buyer: Party = {
    name: s(vevo.nev), taxNumber: s(vevo.adoszam), euVat: s(vevo.adoszameu), address: addr(vevo.cim),
    privatePerson: !s(vevo.adoszam) && !s(vevo.adoszameu),
  };
  const credit = tipus === "SS" || tipus === "SZTORNO" || /storn/i.test(tipus) || (num(ossz.brutto) ?? 0) < 0;
  return {
    docType: credit ? "credit_note" : "invoice",
    direction: "out",
    seller: { name: s(szall.nev), taxNumber: s(szall.adoszam), euVat: s(szall.adoszameu), address: addr(szall.cim) },
    buyer,
    invoiceNumber: s(alap.szamlaszam),
    issueDate: date(alap.kelt),
    fulfillmentDate: date(alap.telj) ?? date(alap.kelt),
    dueDate: date(alap.fizh),
    paymentMethod: paymentOf(alap.fizmod),
    currency: (s(alap.devizanem) ?? "HUF").toUpperCase().replace("FT", "HUF"),
    lines,
    totals: { net: num(ossz.netto), vat: num(ossz.afa), gross: num(ossz.brutto) },
    refInvoiceNumber: s(alap.hivszamlaszam) ?? s(alap.helyesbitettSzamlaszam),
    confidence: 1,
    method: "table",
    notes: "számlázz.hu Számla Agent",
  };
}

/**
 * Sorszám-léptetés: a számlázz.hu-nak nincs listázó végpontja, ezért a beállított előtag
 * és a következő sorszám alapján kérdezzük le egymás után a számlákat.
 * Az előtag a sorszám előtti rész (pl. „E-MMCT-2026-”); ha benne van az évszám, és már új év van,
 * a régi év elfogyása után átvált a következő évre, 1-es sorszámmal.
 */
export function splitInvoiceNumber(n: string): { prefix: string; seq: number } | null {
  const m = /^(.*?)(\d+)\s*$/.exec(n.trim());
  if (!m) return null;
  return { prefix: m[1], seq: Number(m[2]) };
}

export function rollYear(prefix: string, currentYear: number): string | null {
  const m = /(19|20)\d{2}/g;
  let last: RegExpExecArray | null = null;
  for (let x = m.exec(prefix); x; x = m.exec(prefix)) last = x;
  if (!last) return null;
  const y = Number(last[0]);
  if (y >= currentYear) return null;
  return prefix.slice(0, last.index) + String(y + 1) + prefix.slice(last.index + 4);
}

// ---------------------------------------------------------------------------
// Billingo v3 – /documents
// ---------------------------------------------------------------------------

export type BillingoDoc = {
  id: number; invoice_number?: string | null; type?: string | null; cancelled?: boolean | null;
  payment_method?: string | null; currency?: string | null; invoice_date?: string | null; fulfillment_date?: string | null; due_date?: string | null;
  partner?: BillingoPartner | null; document_partner?: BillingoPartner | null;
  items?: Array<{ name?: string | null; quantity?: number | null; unit?: string | null; net_unit_amount?: number | null; net_amount?: number | null; gross_amount?: number | null; vat?: string | null; vat_amount?: number | null }> | null;
  summary?: { net_amount?: number | null; gross_amount?: number | null; vat_amount?: number | null } | null;
  related_documents?: Array<{ id?: number; invoice_number?: string | null }> | null;
  organization?: { name?: string | null; tax_number?: string | null } | null;
};
type BillingoPartner = { name?: string | null; taxcode?: string | null; tax_code?: string | null; address?: { country_code?: string | null; post_code?: string | null; city?: string | null; address?: string | null } | null };

/** Csak a valódi számviteli bizonylatok jönnek be (díjbekérő, piszkozat, szállítólevél nem). */
export function billingoWanted(d: BillingoDoc): boolean {
  const t = (d.type ?? "invoice").toLowerCase();
  return ["invoice", "cancellation", "advance", "modification", "receipt", "final"].includes(t) && !!d.invoice_number;
}

export function fromBillingo(d: BillingoDoc): ExtractedDoc {
  const p = d.document_partner ?? d.partner ?? {};
  const tax = p.taxcode ?? p.tax_code ?? null;
  const a = p.address ?? {};
  const t = (d.type ?? "invoice").toLowerCase();
  const lines: Line[] = (d.items ?? []).map((i) => ({
    description: i.name || "Tétel",
    quantity: i.quantity ?? null,
    unitNet: i.net_unit_amount ?? null,
    net: i.net_amount ?? 0,
    ...vatOf(i.vat),
    vat: i.vat_amount ?? null,
    gross: i.gross_amount ?? null,
  }));
  const isEu = !!tax && /^[A-Z]{2}/.test(tax) && !/^HU/i.test(tax);
  return {
    docType: t === "cancellation" || (d.summary?.gross_amount ?? 0) < 0 ? "credit_note" : "invoice",
    direction: "out",
    seller: d.organization ? { name: d.organization.name ?? null, taxNumber: d.organization.tax_number ?? null } : null,
    buyer: {
      name: p.name ?? null, taxNumber: isEu ? null : tax, euVat: isEu ? tax : null,
      address: [a.post_code, a.city, a.address].filter(Boolean).join(" ") || null,
      privatePerson: !tax,
    },
    invoiceNumber: d.invoice_number ?? null,
    issueDate: date(d.invoice_date),
    fulfillmentDate: date(d.fulfillment_date) ?? date(d.invoice_date),
    dueDate: date(d.due_date),
    paymentMethod: paymentOf(d.payment_method),
    currency: (d.currency ?? "HUF").toUpperCase(),
    lines,
    totals: { net: d.summary?.net_amount ?? null, vat: d.summary?.vat_amount ?? null, gross: d.summary?.gross_amount ?? null },
    refInvoiceNumber: t === "cancellation" || t === "modification" ? d.related_documents?.[0]?.invoice_number ?? null : null,
    confidence: 1,
    method: "table",
    notes: "Billingo API",
  };
}

export type { InvoicingLink } from "@/db/schema";
