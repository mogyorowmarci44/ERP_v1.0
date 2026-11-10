/**
 * Könyvelési javaslat a kiolvasott bizonylatból – tiszta, szabályalapú logika (adatbázis nélkül, tesztelhető).
 * Forrás: a partner korábbi könyvelt számlái (főkönyvi számla, ÁFA-kód, autóhoz kötés), a gépkocsi-törzs és a nyitott tételek.
 */
import type { ExtractedDoc, InboxProposal } from "@/db/schema";

export type CtxPartner = { id: number; name: string; taxNumber: string | null; isPrivatePerson: boolean; country: string };
export type CtxHistoryLine = { partnerId: number; direction: "in" | "out"; accountCode: string; vatCode: string; description: string; hasVehicle: boolean; periodic: boolean };
export type CtxVehicle = { id: number; make: string; model: string; plate: string | null; vin: string | null; status: string };
export type CtxOpenInvoice = { id: number; direction: "in" | "out"; partnerName: string; number: string; currency: string; openFx: number; openHuf: number; dueDate: string | null };
export type ProposeCtx = {
  company: { name: string; taxNumber: string | null };
  partners: CtxPartner[];
  history: CtxHistoryLine[];
  vehicles: CtxVehicle[];
  /** meglévő számlák: `${direction}|${partnerId}|${szám}` és `${direction}|*|${szám}` kulcsok */
  existing: Set<string>;
  vatCodes: Set<string>;
  open: CtxOpenInvoice[];
  /** már könyvelt pénzmozgások: `${accountCode}|${dátum}|${összeg}` */
  moneyMoves: Set<string>;
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const tax8 = (s: string | null | undefined) => digits(s).slice(0, 8);
const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(kft|zrt|bt|nyrt|kkt|ev|e\.v|se|gmbh|b\.v|bv|ltd)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const plateKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const tokens = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 2));
const similarity = (a: string, b: string) => {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
};

export function vatCodeFor(vatType: string | null | undefined, vatRate: number | null | undefined): string | null {
  const t = (vatType ?? "").toUpperCase().replace(/\s/g, "");
  if (/^(KÜL|KUL|K\.?AFA|KAFA|M)$/.test(t) || t.includes("KÜLÖNBÖZET")) return "KÜL27";
  if (/^(TAH|AHK|ATK)/.test(t)) return "TAH";
  if (/^(FAD|RC|REVERSE)/.test(t) || t === "I" || t === "L") return "FAD27";
  if (/^(AAM|TAM|AM|MENTES)/.test(t)) return "AM";
  const r = vatRate ?? (/^\d+$/.test(t) ? Number(t) : null);
  if (r === 27) return "27";
  if (r === 18) return "18";
  if (r === 5) return "5";
  if (r === 0) return "AM";
  return null;
}

export function matchPartner(ctx: ProposeCtx, p: ExtractedDoc["seller"]): CtxPartner | null {
  if (!p) return null;
  const t = tax8(p.taxNumber);
  if (t.length === 8) {
    const hit = ctx.partners.find((x) => tax8(x.taxNumber) === t);
    if (hit) return hit;
  }
  const n = norm(p.name);
  if (!n) return null;
  return ctx.partners.find((x) => norm(x.name) === n) ?? ctx.partners.find((x) => n.length > 5 && (norm(x.name).startsWith(n) || n.startsWith(norm(x.name)))) ?? null;
}

export function matchVehicle(ctx: ProposeCtx, v: ExtractedDoc["vehicle"], texts: string[]): CtxVehicle | null {
  const vin = plateKey(v?.vin);
  if (vin.length >= 11) {
    const hit = ctx.vehicles.find((x) => plateKey(x.vin) === vin);
    if (hit) return hit;
  }
  const pl = plateKey(v?.plate);
  if (pl.length >= 5) {
    const hit = ctx.vehicles.find((x) => plateKey(x.plate) === pl);
    if (hit) return hit;
  }
  // rendszám / alvázszám a tételszövegben
  const blob = plateKey(texts.join(" "));
  return ctx.vehicles.find((x) => (x.vin && plateKey(x.vin).length >= 11 && blob.includes(plateKey(x.vin))) || (x.plate && plateKey(x.plate).length >= 6 && blob.includes(plateKey(x.plate)))) ?? null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Számla / nyugta / adásvételi → számla-javaslat. */
export function proposeInvoice(ctx: ProposeCtx, x: ExtractedDoc, today: string): InboxProposal {
  const issues: string[] = [];
  if (x.docType === "proforma") return { kind: "none", issues: ["Díjbekérő – nem könyvelendő (a számla majd külön jön)."] };
  if (x.docType === "other" || x.docType === "bank_statement") return { kind: "none", issues: ["Nem számla jellegű bizonylat."] };
  const ourTax = tax8(ctx.company.taxNumber);
  const direction: "in" | "out" = x.direction ?? (ourTax && tax8(x.seller?.taxNumber) === ourTax ? "out" : "in");
  const cp = direction === "in" ? x.seller : x.buyer;
  if (!cp?.name) issues.push("Nem olvasható a partner neve.");
  const partner = matchPartner(ctx, cp);
  const isContract = x.docType === "sale_contract";
  const priv = !!(cp?.privatePerson ?? (isContract && !cp?.taxNumber));
  const number = (x.invoiceNumber ?? "").trim() || (isContract ? `AV-${x.fulfillmentDate ?? x.issueDate ?? today}-${plateKey(x.vehicle?.plate) || plateKey(x.vehicle?.vin).slice(-6) || "AUTO"}` : "");
  if (!number) issues.push("Nem olvasható a számlaszám.");
  const issueDate = x.issueDate ?? x.fulfillmentDate ?? null;
  const fulfillmentDate = x.fulfillmentDate ?? x.issueDate ?? null;
  if (!issueDate || !fulfillmentDate) issues.push("Nem olvasható a dátum.");
  if (x.docType === "credit_note" || x.refInvoiceNumber) issues.push(`Sztornó / helyesbítő számla${x.refInvoiceNumber ? ` (eredeti: ${x.refInvoiceNumber})` : ""} – kézi ellenőrzés kell.`);

  // duplikáció
  if (number && ((partner && ctx.existing.has(`${direction}|${partner.id}|${number}`)) || (direction === "out" && ctx.existing.has(`out|*|${number}`))))
    return { kind: "none", issues: [`Már könyvelve: ${number}`] };

  // gépkocsi
  const texts = [...(x.lines ?? []).map((l) => l.description), x.notes ?? ""];
  const veh = matchVehicle(ctx, x.vehicle, texts);
  const hasVehInfo = !!(x.vehicle?.vin || x.vehicle?.plate);
  const hist = partner ? ctx.history.filter((h) => h.partnerId === partner.id && h.direction === direction) : [];

  const lines: NonNullable<InboxProposal["invoice"]>["lines"] = [];
  let newVehicle = false;
  for (const l of x.lines ?? []) {
    let vat = vatCodeFor(l.vatType, l.vatRate) ?? (isContract ? "KÜL27" : null);
    let account: string | null = null;
    // a partner korábbi könyvelése: a leghasonlóbb tétel, különben a leggyakoribb számla
    if (hist.length) {
      const best = [...hist].sort((a, b) => similarity(l.description, b.description) - similarity(l.description, a.description))[0];
      const freq = new Map<string, number>();
      for (const h of hist) freq.set(`${h.accountCode}|${h.vatCode}`, (freq.get(`${h.accountCode}|${h.vatCode}`) ?? 0) + 1);
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0].split("|");
      const pick = similarity(l.description, best.description) >= 0.5 ? best : { accountCode: top[0], vatCode: top[1] };
      account = pick.accountCode;
      if (!vat) vat = pick.vatCode;
    }
    const isCarPurchase = direction === "in" && (isContract || vat === "KÜL27");
    if (!account) {
      if (direction === "out") account = "911";
      else if (isCarPurchase) account = "261";
      else {
        account = "529";
        if (!issues.some((i) => i.startsWith("Új szállító"))) issues.push("Új szállító – a főkönyvi számla (529) csak javaslat, ellenőrizd.");
      }
    }
    if (!vat) { issues.push(`Nem állapítható meg az ÁFA-kód: ${l.description}`); vat = "27"; }
    if (!ctx.vatCodes.has(vat)) issues.push(`Ismeretlen ÁFA-kód: ${vat}`);
    const qty = l.quantity && l.quantity > 0 ? l.quantity : 1;
    const net = vat === "KÜL27" || vat === "TAH" || vat === "AM" ? (l.gross ?? l.net) : l.net;
    const needsVehicle = account.startsWith("261") || (direction === "out" && vat === "KÜL27");
    let vehicleId: number | null = null;
    if (needsVehicle) {
      if (veh) vehicleId = veh.id;
      else if (isCarPurchase && hasVehInfo) newVehicle = true;
      else issues.push(`Gépkocsihoz kell rendelni: ${l.description}`);
    }
    lines.push({ description: l.description, quantity: qty, unitPrice: r2(net / qty), accountCode: account, vatCode: vat, vehicleId, newVehicle: needsVehicle && !vehicleId && newVehicle });
  }
  if (!lines.length) issues.push("Nincs kiolvasható tétel.");
  if (veh && direction === "out" && veh.status === "sold") issues.push(`A gépkocsi (${veh.plate || veh.vin}) már eladottként szerepel.`);

  // összegellenőrzés
  const sumNet = (x.lines ?? []).reduce((a, l) => a + (l.net ?? 0), 0);
  const sumVat = (x.lines ?? []).reduce((a, l) => a + (l.vat ?? 0), 0);
  const gross = x.totals?.gross;
  if (gross != null && Math.abs(sumNet + sumVat - gross) > 2 && Math.abs((x.lines ?? []).reduce((a, l) => a + (l.gross ?? 0), 0) - gross) > 2)
    issues.push(`A tételek összege (${r2(sumNet + sumVat)}) eltér a végösszegtől (${gross}).`);
  if (!partner && !priv) issues.push("Új partner – ellenőrizd az adatait.");
  if ((x.confidence ?? 1) < 0.7) issues.push("Bizonytalan kiolvasás (rossz minőségű kép?) – ellenőrizd.");

  const pm = x.paymentMethod ?? (isContract ? "cash" : "transfer");
  const currency = (x.currency || "HUF").toUpperCase();
  const payNow = (pm === "cash" || (isContract && pm !== "transfer")) && fulfillmentDate ? { date: fulfillmentDate, accountCode: currency === "HUF" ? "381" : "3811" } : null;
  const periodic = !!(x.periodic ?? hist.some((h) => h.periodic));

  return {
    kind: "invoice",
    issues,
    basis: partner ? (hist.length ? `${partner.name}: ${new Set(hist.map((h) => h.accountCode)).size === 1 ? `korábbi könyvelés (${hist[0].accountCode})` : "korábbi könyvelések alapján"}` : `${partner.name}: ismert partner, korábbi számla nélkül`) : "új partner",
    invoice: {
      direction,
      partner: { id: partner?.id ?? null, name: partner?.name ?? cp?.name ?? "Ismeretlen", taxNumber: partner?.taxNumber ?? cp?.taxNumber ?? null, privatePerson: partner?.isPrivatePerson ?? priv, country: partner?.country ?? (cp?.euVat && !/^HU/i.test(cp.euVat) ? cp.euVat.slice(0, 2).toUpperCase() : "HU") },
      invoiceNumber: number,
      issueDate: issueDate ?? today,
      fulfillmentDate: fulfillmentDate ?? today,
      dueDate: x.dueDate ?? null,
      paymentMethod: pm,
      currency,
      periodic,
      lines,
      payNow,
      vehicle: newVehicle ? { make: x.vehicle?.make || "Gépkocsi", model: x.vehicle?.model || "", plate: x.vehicle?.plate ?? null, vin: x.vehicle?.vin ?? null } : veh ? { id: veh.id, make: veh.make, model: veh.model, plate: veh.plate, vin: veh.vin } : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Bankkivonat → párosítás a nyitott számlákkal
// ---------------------------------------------------------------------------

const FEE = /(díj|jutalék|különdíj|kezelési|zárlati|számlavezet|tranz\.?\s*díj|egyenleglek)/i;
const INSURANCE = /(biztosítás|biztositas)/i;
const CASH_IN = /(készpénz.?befizet|kp\.?\s*befiz|pénztári készpénz|atm készpénz)/i;

export function proposeStatement(ctx: ProposeCtx, x: ExtractedDoc): InboxProposal {
  const st = x.statement;
  if (!st?.transactions?.length) return { kind: "none", issues: ["Nincs kiolvasható tranzakció a kivonaton."] };
  const cur = (st.currency || "HUF").toUpperCase();
  const money = cur === "EUR" ? "3841" : "384";
  const used = new Set<number>();
  const rows: NonNullable<InboxProposal["statement"]>["rows"] = st.transactions.map((t, idx) => {
    const amt = Math.round(t.amount * 100) / 100;
    const text = [t.counterparty, t.description, t.reference].filter(Boolean).join(" · ");
    const base = { idx, date: t.date, amount: amt, text };
    if (ctx.moneyMoves.has(`${money}|${t.date}|${Math.abs(amt)}`) || (t.valueDate && ctx.moneyMoves.has(`${money}|${t.valueDate}|${Math.abs(amt)}`)))
      return { ...base, action: "skip" as const, reason: "már könyvelve" };
    if (amt > 0 && CASH_IN.test(text)) return { ...base, action: "transfer" as const, accountCode: "381", reason: "készpénz befizetése a pénztárból" };
    if (amt < 0 && FEE.test(text) && !t.counterpartyAccount) return { ...base, action: "entry" as const, accountCode: "532", reason: "bankköltség" };
    if (amt < 0 && INSURANCE.test(text) && !t.counterpartyAccount) return { ...base, action: "entry" as const, accountCode: "533", reason: "biztosítás" };
    // nyitott számla: hivatkozott számlaszám > partnernév + összeg
    const dir = amt < 0 ? "in" : "out";
    const cands = ctx.open.filter((o) => o.direction === dir && !used.has(o.id));
    const ref = plateKey(`${t.reference ?? ""} ${t.description ?? ""}`);
    const byNumber = cands.filter((o) => plateKey(o.number).length >= 4 && ref.includes(plateKey(o.number)));
    const amountOk = (o: CtxOpenInvoice) => {
      if (o.currency === "HUF") return Math.abs(o.openHuf - Math.abs(amt)) <= 2;
      if (t.fxAmount && t.fxCurrency?.toUpperCase() === o.currency) return Math.abs(o.openFx - Math.abs(t.fxAmount)) <= 0.05;
      return Math.abs(o.openHuf - Math.abs(amt)) / o.openHuf < 0.05; // devizás számla forintból: ±5% árfolyam-eltérés
    };
    const byName = cands.filter((o) => amountOk(o) && similarity(o.partnerName, `${t.counterparty ?? ""} ${t.description ?? ""}`) >= 0.5);
    const hit = byNumber.find(amountOk) ?? (byName.length === 1 ? byName[0] : undefined) ?? (byNumber.length === 1 ? byNumber[0] : undefined);
    if (hit) {
      used.add(hit.id);
      const full = amountOk(hit);
      return { ...base, action: full ? ("pay_invoice" as const) : ("review" as const), invoiceId: hit.id, invoiceLabel: `${hit.partnerName} ${hit.number}`, reason: full ? null : "részfizetés vagy eltérő összeg" };
    }
    return { ...base, action: "review" as const, reason: "nincs egyértelmű párosítás" };
  });
  const issues: string[] = [];
  const review = rows.filter((r) => r.action === "review").length;
  if (review) issues.push(`${review} tétel kézi párosítást igényel.`);
  if (st.opening != null && st.closing != null) {
    const sum = st.transactions.reduce((a, t) => a + t.amount, 0);
    if (Math.abs(st.opening + sum - st.closing) > 1) issues.push(`A kivonat nyitó + forgalom (${Math.round(st.opening + sum)}) ≠ záró (${st.closing}) – lehet, hogy hiányzik tranzakció a kiolvasásból.`);
  }
  return { kind: "statement", issues, statement: { moneyAccountCode: money, rows }, basis: `${st.number ? `${st.number} kivonat, ` : ""}${rows.length} tétel` };
}
