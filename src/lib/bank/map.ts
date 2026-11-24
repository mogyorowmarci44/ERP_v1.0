/**
 * v3.10.0 – Banki tranzakciók (Enable Banking / PSD2, Berlin Group-szerű mezők) átalakítása a Beérkező bizonylatok
 * kivonat-formátumára (ExtractedDoc.statement). Tiszta függvények – tesztelhető, hálózat nélkül.
 */
import type { ExtractedDoc } from "@/db/schema";

export type EbAmount = { currency?: string | null; amount?: string | number | null };
export type EbParty = { name?: string | null } | null | undefined;
export type EbAccountRef = { iban?: string | null; other?: { identification?: string | null } | null; bban?: string | null } | null | undefined;

/** Az Enable Banking `GET /accounts/{id}/transactions` válaszának egy tétele (csak a használt mezők). */
export type EbTransaction = {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: EbAmount;
  credit_debit_indicator?: "CRDT" | "DBIT" | string | null;
  status?: "BOOK" | "PDNG" | "INFO" | string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: EbParty;
  creditor_account?: EbAccountRef;
  debtor?: EbParty;
  debtor_account?: EbAccountRef;
  remittance_information?: string[] | null;
  reference_number?: string | null;
  note?: string | null;
  exchange_rate?: { unit_currency?: string | null; source_currency?: string | null; instructed_amount?: EbAmount | null } | null;
};

export type StatementTx = NonNullable<ExtractedDoc["statement"]>["transactions"][number];

const accountText = (a: EbAccountRef) => (a?.iban || a?.bban || a?.other?.identification || "").replace(/\s+/g, "") || null;

/** Stabil azonosító a duplikáció-szűréshez (ha a bank nem ad entry_reference-t, a tartalomból képezzük). */
export function txKey(t: EbTransaction): string {
  if (t.entry_reference) return `ref:${t.entry_reference}`;
  if (t.transaction_id) return `id:${t.transaction_id}`;
  const amt = Number(t.transaction_amount?.amount ?? 0);
  return `h:${t.booking_date ?? ""}|${t.credit_debit_indicator ?? ""}|${amt}|${(t.remittance_information ?? []).join(" ").slice(0, 80)}|${t.creditor?.name ?? t.debtor?.name ?? ""}`;
}

export function bookingDateOf(t: EbTransaction): string | null {
  const d = t.booking_date || t.value_date || t.transaction_date || null;
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/** Egy tranzakció kivonatsorrá: előjeles összeg (jóváírás +, terhelés −), ellenoldali partner és számla. */
export function toStatementTx(t: EbTransaction): StatementTx | null {
  const date = bookingDateOf(t);
  const raw = Number(String(t.transaction_amount?.amount ?? "").replace(",", "."));
  if (!date || !Number.isFinite(raw) || raw === 0) return null;
  // Az összeg a legtöbb banknál előjel nélküli, az irányt a credit_debit_indicator adja; ha előjeles, azt tiszteletben tartjuk.
  const credit = t.credit_debit_indicator ? t.credit_debit_indicator === "CRDT" : raw > 0;
  const amount = Math.round((credit ? Math.abs(raw) : -Math.abs(raw)) * 100) / 100;
  const counter = credit ? { p: t.debtor, a: t.debtor_account } : { p: t.creditor, a: t.creditor_account };
  const desc = [...(t.remittance_information ?? []), t.note ?? ""].map((s) => s.trim()).filter(Boolean).join(" ");
  const fx = t.exchange_rate?.instructed_amount;
  const fxAmount = fx?.amount != null ? Math.abs(Number(fx.amount)) : null;
  return {
    date,
    valueDate: t.value_date ? t.value_date.slice(0, 10) : null,
    amount,
    counterparty: counter.p?.name?.trim() || null,
    counterpartyAccount: accountText(counter.a),
    description: desc || null,
    reference: t.reference_number || null,
    fxAmount: fxAmount && Number.isFinite(fxAmount) ? (credit ? fxAmount : -fxAmount) : null,
    fxCurrency: fxAmount ? fx?.currency ?? null : null,
  };
}

export type DayBatch = { date: string; keys: string[]; transactions: StatementTx[] };

/**
 * Napi csomagok a könyvelt (BOOK) tételekből: csak a `[since, until]` közötti napok, a már ismert kulcsok nélkül.
 * A függőben lévő (PDNG) tételek kimaradnak – majd könyvelt állapotban jönnek újra.
 */
export function dailyBatches(txs: EbTransaction[], opts: { since: string; until: string; known: Set<string> }): DayBatch[] {
  const byDay = new Map<string, DayBatch>();
  const seen = new Set<string>();
  for (const t of txs) {
    if (t.status && t.status !== "BOOK") continue;
    const k = txKey(t);
    if (opts.known.has(k) || seen.has(k)) continue;
    const st = toStatementTx(t);
    if (!st || st.date < opts.since || st.date > opts.until) continue;
    seen.add(k);
    const b = byDay.get(st.date) ?? { date: st.date, keys: [], transactions: [] };
    b.keys.push(k);
    b.transactions.push(st);
    byDay.set(st.date, b);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** A kivonat-bizonylat kiolvasott adata (a meglévő javaslat- és könyvelési lánc ezt dolgozza fel). */
export function batchToExtracted(b: DayBatch, account: { iban?: string | null; currency: string }): ExtractedDoc {
  return {
    docType: "bank_statement",
    statement: { accountNumber: account.iban ?? null, currency: account.currency, periodFrom: b.date, periodTo: b.date, transactions: b.transactions },
    confidence: 1,
    method: "table",
    notes: `Banki API (Enable Banking): ${b.transactions.length} könyvelt tranzakció, ${b.date}.`,
  };
}
