/**
 * Kontírozási logika – tiszta függvények, adatbázis nélkül tesztelhetők.
 *
 * Előjelek: a főkönyvi sorban debit (Tartozik) és credit (Követel) külön oszlop.
 * Storno: ugyanazon oldalon negatív összeg (piros storno), így a forgalom nem duzzad.
 */
import { round2, roundHuf } from "./money";

export type VatKind =
  | "normal"
  | "margin"
  | "exempt"
  | "out_of_scope"
  | "reverse_charge"
  | "eu_acquisition"
  | "eu_supply"
  | "export";

export type Direction = "out" | "in";

export type LineInput = {
  quantity: number;
  /** Egységár a számla devizájában; különbözeti tételnél bruttó. */
  unitPrice: number;
  vatRate: number; // pl. 27
  vatKind: VatKind;
  /** Különbözeti értékesítésnél: a gépkocsi beszerzési ára HUF-ban. */
  marginPurchaseHuf?: number | null;
};

export type LineAmounts = {
  netFx: number;
  vatFx: number;
  grossFx: number;
  netHuf: number;
  vatHuf: number;
  grossHuf: number;
  /** A partnerrel szembeni összeg (fordított adózásnál a nettó, mert az ÁFA-t mi fizetjük). */
  payableFx: number;
  payableHuf: number;
};

/** Önadózós ÁFA-típusok: az ÁFA nem része a partner felé fizetendőnek, egyszerre levonható és fizetendő. */
export const SELF_ASSESSED: VatKind[] = ["reverse_charge", "eu_acquisition"];
export const ZERO_VAT: VatKind[] = ["exempt", "out_of_scope", "eu_supply", "export"];

export function computeLine(input: LineInput, direction: Direction, fxRate: number): LineAmounts {
  const { quantity, unitPrice, vatRate, vatKind } = input;
  const conv = (fx: number) => roundHuf(fx * fxRate);

  if (vatKind === "margin") {
    const grossFx = round2(quantity * unitPrice);
    const grossHuf = conv(grossFx);
    let vatHuf = 0;
    if (direction === "out") {
      if (input.marginPurchaseHuf === null || input.marginPurchaseHuf === undefined) {
        throw new Error("Különbözeti értékesítéshez meg kell adni a gépkocsit / beszerzési árat.");
      }
      const margin = grossHuf - input.marginPurchaseHuf;
      // Áfa tv. 213. §: az árrés ÁFA-t tartalmazó összeg → ÁFA = árrés × kulcs / (100 + kulcs); negatív árrés esetén 0.
      vatHuf = margin > 0 ? roundHuf((margin * vatRate) / (100 + vatRate)) : 0;
    }
    // Beszerzési oldalon (különbözeti számlát kapunk) nincs levonható ÁFA.
    const netHuf = grossHuf - vatHuf;
    const vatFx = fxRate === 1 ? vatHuf : round2(vatHuf / fxRate);
    return {
      netFx: round2(grossFx - vatFx),
      vatFx,
      grossFx,
      netHuf,
      vatHuf,
      grossHuf,
      payableFx: grossFx,
      payableHuf: grossHuf,
    };
  }

  const netFx = round2(quantity * unitPrice);
  const vatFx = ZERO_VAT.includes(vatKind) ? 0 : round2((netFx * vatRate) / 100);
  const netHuf = conv(netFx);
  const vatHuf = ZERO_VAT.includes(vatKind) ? 0 : conv(vatFx);
  const selfAssessed = SELF_ASSESSED.includes(vatKind);
  return {
    netFx,
    vatFx,
    grossFx: round2(netFx + vatFx),
    netHuf,
    vatHuf,
    grossHuf: netHuf + vatHuf,
    payableFx: selfAssessed ? netFx : round2(netFx + vatFx),
    payableHuf: selfAssessed ? netHuf : netHuf + vatHuf,
  };
}

// ---------------------------------------------------------------------------
// Számla kontírozás
// ---------------------------------------------------------------------------

export type DraftLine = {
  accountId: number;
  debit: number;
  credit: number;
  description?: string | null;
  partnerId?: number | null;
  vehicleId?: number | null;
  vatCodeId?: number | null;
  currency?: string | null;
  amountFx?: number | null;
  fxRate?: number | null;
};

export type PostingAccounts = {
  partnerAccountId: number; // 311/316 vagy 454/455
  inputVatId: number; // 466
  outputVatId: number; // 467
  inventoryId: number; // 261
  cogsId: number; // 814
};

export type InvoiceForPosting = {
  direction: Direction;
  partnerId: number;
  currency: string;
  fxRate: number;
  invoiceNumber: string;
  lines: Array<
    LineInput & {
      description: string;
      accountId: number;
      vatCodeId: number;
      vehicleId?: number | null;
    }
  >;
};

export type InvoicePostingResult = {
  lines: DraftLine[];
  totals: { netHuf: number; vatHuf: number; grossHuf: number; payableHuf: number; payableFx: number };
  computed: LineAmounts[];
};

/**
 * Számla → főkönyvi sorok.
 * Vevőszámla:     T 311 bruttó  /  K 9xx nettó, K 467 ÁFA
 * Szállítói:      T 5xx/261/1xx nettó, T 466 ÁFA  /  K 454 bruttó
 * Fordított / KBB: T 466 ÁFA / K 467 ÁFA (a partner felé csak a nettó)
 * Gépkocsi eladás: + T 814 / K 261 a gépkocsi könyv szerinti értékén (vehicleBookValues).
 */
export function buildInvoicePosting(
  inv: InvoiceForPosting,
  acc: PostingAccounts,
  vehicleBookValues: Map<number, number> = new Map(),
): InvoicePostingResult {
  const out: DraftLine[] = [];
  const computed: LineAmounts[] = [];
  const isFx = inv.currency !== "HUF";
  const fxMeta = (amountFx: number) =>
    isFx ? { currency: inv.currency, amountFx, fxRate: inv.fxRate } : { currency: null, amountFx: null, fxRate: null };

  let netHuf = 0,
    vatHuf = 0,
    grossHuf = 0,
    payableHuf = 0,
    payableFx = 0;

  for (const l of inv.lines) {
    const a = computeLine(l, inv.direction, inv.fxRate);
    computed.push(a);
    netHuf += a.netHuf;
    vatHuf += a.vatHuf;
    grossHuf += a.grossHuf;
    payableHuf += a.payableHuf;
    payableFx = round2(payableFx + a.payableFx);

    const base = {
      description: l.description,
      partnerId: inv.partnerId,
      vatCodeId: l.vatCodeId,
      vehicleId: l.vehicleId ?? null,
    };
    const selfAssessed = SELF_ASSESSED.includes(l.vatKind);

    if (inv.direction === "out") {
      out.push({ ...base, accountId: l.accountId, debit: 0, credit: a.netHuf, ...fxMeta(a.netFx) });
      if (a.vatHuf !== 0) {
        out.push({ ...base, vehicleId: null, accountId: acc.outputVatId, debit: 0, credit: a.vatHuf, ...fxMeta(a.vatFx) });
      }
      // Eladott gépkocsi bekerülési értékének kivezetése
      if (l.vehicleId) {
        const bv = vehicleBookValues.get(l.vehicleId) ?? 0;
        if (bv !== 0) {
          out.push({ ...base, vatCodeId: null, accountId: acc.cogsId, debit: bv, credit: 0, description: `ELÁBÉ: ${l.description}`, currency: null, amountFx: null, fxRate: null });
          out.push({ ...base, vatCodeId: null, accountId: acc.inventoryId, debit: 0, credit: bv, description: `Készletcsökkenés: ${l.description}`, currency: null, amountFx: null, fxRate: null });
        }
      }
    } else {
      out.push({ ...base, accountId: l.accountId, debit: a.netHuf, credit: 0, ...fxMeta(a.netFx) });
      if (a.vatHuf !== 0) {
        out.push({ ...base, vehicleId: null, accountId: acc.inputVatId, debit: a.vatHuf, credit: 0, ...fxMeta(a.vatFx) });
        if (selfAssessed) {
          out.push({ ...base, vehicleId: null, accountId: acc.outputVatId, debit: 0, credit: a.vatHuf, ...fxMeta(a.vatFx) });
        }
      }
    }
  }

  // Partner sor (vevő / szállító) – egyben, a fizetendő összeggel
  const partnerLine: DraftLine = {
    accountId: acc.partnerAccountId,
    debit: inv.direction === "out" ? payableHuf : 0,
    credit: inv.direction === "in" ? payableHuf : 0,
    description: `${inv.direction === "out" ? "Vevő" : "Szállító"}: ${inv.invoiceNumber}`,
    partnerId: inv.partnerId,
    ...fxMeta(payableFx),
  };
  out.unshift(partnerLine);

  assertBalanced(out);
  return { lines: out, totals: { netHuf, vatHuf, grossHuf, payableHuf, payableFx }, computed };
}

// ---------------------------------------------------------------------------
// Pénzügyi rendezés (árfolyam-különbözettel)
// ---------------------------------------------------------------------------

export type PaymentInput = {
  direction: Direction;
  partnerId: number;
  invoiceNumber: string;
  /** A számla devizaneme. */
  currency: string;
  /** Kiegyenlített összeg a számla devizájában. */
  amountFx: number;
  /**
   * Pénzeszköz oldali forintérték (Szt. 60. §):
   *  - forintszámláról/-ra: a ténylegesen terhelt / jóváírt forint,
   *  - devizaszámlára befolyó: választott (MNB) árfolyamon,
   *  - devizaszámláról kifizetett: a deviza könyv szerinti (átlag)árfolyamán.
   */
  moneyHuf: number;
  /** Ha a pénzeszköz devizás: a pénzeszköz sor devizaadatai. */
  moneyFx?: { currency: string; rate: number } | null;
  /** Vevő / szállító oldali forintérték (a számla könyv szerinti árfolyamán, teljes rendezésnél a nyitott HUF egyenleg). */
  partnerHuf: number;
  invoiceRate: number;
};

export type PaymentAccounts = {
  partnerAccountId: number;
  moneyAccountId: number;
  fxGainId: number;
  fxLossId: number;
};

export function buildPaymentPosting(p: PaymentInput, acc: PaymentAccounts): { lines: DraftLine[]; fxDiff: number } {
  const isFx = p.currency !== "HUF";
  const partnerMeta = isFx ? { currency: p.currency, amountFx: p.amountFx, fxRate: p.invoiceRate } : {};
  const moneyMeta = p.moneyFx ? { currency: p.moneyFx.currency, amountFx: p.amountFx, fxRate: p.moneyFx.rate } : {};
  const desc = `${p.direction === "out" ? "Vevő befizetés" : "Szállító kifizetés"}: ${p.invoiceNumber}`;
  const moneyHuf = roundHuf(p.moneyHuf);
  const partnerHuf = round2(p.partnerHuf);

  const lines: DraftLine[] = [];
  let fxDiff: number;
  if (p.direction === "out") {
    lines.push({ accountId: acc.moneyAccountId, debit: moneyHuf, credit: 0, description: desc, partnerId: p.partnerId, ...moneyMeta });
    lines.push({ accountId: acc.partnerAccountId, debit: 0, credit: partnerHuf, description: desc, partnerId: p.partnerId, ...partnerMeta });
    fxDiff = round2(moneyHuf - partnerHuf); // + nyereség
  } else {
    lines.push({ accountId: acc.partnerAccountId, debit: partnerHuf, credit: 0, description: desc, partnerId: p.partnerId, ...partnerMeta });
    lines.push({ accountId: acc.moneyAccountId, debit: 0, credit: moneyHuf, description: desc, partnerId: p.partnerId, ...moneyMeta });
    fxDiff = round2(partnerHuf - moneyHuf); // + nyereség (kevesebbet fizettünk)
  }
  if (fxDiff > 0) {
    lines.push({ accountId: acc.fxGainId, debit: 0, credit: fxDiff, description: "Realizált árfolyamnyereség", partnerId: p.partnerId });
  } else if (fxDiff < 0) {
    lines.push({ accountId: acc.fxLossId, debit: -fxDiff, credit: 0, description: "Realizált árfolyamveszteség", partnerId: p.partnerId });
  }
  assertBalanced(lines);
  return { lines, fxDiff };
}

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

export function assertBalanced(lines: Pick<DraftLine, "debit" | "credit">[]): void {
  const d = round2(lines.reduce((s, l) => s + l.debit, 0));
  const c = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (d !== c) throw new Error(`A könyvelési tétel nincs egyensúlyban: T ${d} ≠ K ${c}`);
  if (lines.length < 2) throw new Error("Egy könyvelési tételnek legalább két sora kell legyen.");
}

/** Piros storno: ugyanaz az oldal, negatív összeggel. */
export function stornoLines<T extends DraftLine>(lines: T[]): T[] {
  return lines.map((l) => ({
    ...l,
    debit: l.debit === 0 ? 0 : -l.debit,
    credit: l.credit === 0 ? 0 : -l.credit,
    amountFx: l.amountFx ? -l.amountFx : l.amountFx,
  }));
}
