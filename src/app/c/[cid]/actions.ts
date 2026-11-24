"use server";

import { revalidatePath } from "next/cache";
import { linkEntryToInvoice, offsetInvoices } from "@/lib/matching";
import { closeVatPeriod, reopenVatPeriod } from "@/lib/vat-closing";
import { releaseAccrual } from "@/lib/accruals";
import { parseDelta, runDelta, type DeltaReport } from "@/lib/delta-import";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import {
  saveInvoiceDraft,
  postInvoice,
  cancelInvoice,
  payInvoice,
  reversePayment,
  manualEntry,
  reverseEntry,
  lockPeriod,
  unlockPeriod,
  type InvoiceInput,
} from "@/lib/ledger";
import { runOrRedirect, str, optStr, intOrNull, errMsg } from "@/lib/action-utils";
import { parseNumber, fmtNum } from "@/lib/money";
import { isDate, today } from "@/lib/dates";
import type { DraftLine } from "@/lib/posting";
import { getMnbRate, storeRates, fetchMnbRates } from "@/lib/fx-service";
import { addDays } from "@/lib/fx";
import { PRESETS, isHex } from "@/lib/themes";
import { importBundle, importLoanTermsOnly, wipeCompanyData, type ImportBundle, type ImportReport } from "@/lib/importer";
import { saveMember, deleteMember } from "@/lib/company-members";
import { extendLoan, recordMemberLoan, revalueMemberLoans, setLoanDueDate, undoLastExtension } from "@/lib/member-loans";
import { invoiceAudit } from "@/lib/invoice-audit";
import { updateEntryMeta, renameInvoiceLine, setEntryChecked, updateManualEntry, reopenInvoice, logInvoiceRepost, editPayment, type EntryLineInput } from "@/lib/journal-edit";
import { DEFAULT_TAX_PROFILE, isPrivate, taxProfileFromForm } from "@/lib/entity";
import { cleanPartnerInput, findDuplicatePartner, type NewPartnerInput } from "@/lib/partner-input";

const cidOf = (fd: FormData) => Number(fd.get("cid"));

// --- Partnerek -------------------------------------------------------------

export async function savePartnerAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/partners`, async () => {
    const id = intOrNull(fd, "id");
    const clean = cleanPartnerInput({
      name: str(fd, "name"),
      taxNumber: optStr(fd, "taxNumber"),
      euVatNumber: optStr(fd, "euVatNumber"),
      country: str(fd, "country"),
      address: optStr(fd, "address"),
      email: optStr(fd, "email"),
      isPrivatePerson: fd.get("isPrivatePerson") === "on",
    }, { requireHuTax: !id });
    const values = { companyId: cid, ...clean, note: optStr(fd, "note") };
    if (!id) {
      const existing = await db.select().from(schema.partners).where(eq(schema.partners.companyId, cid));
      const dup = findDuplicatePartner(existing, clean);
      if (dup) throw new Error(`Ez a partner már szerepel: ${dup.name}${dup.taxNumber ? ` (${dup.taxNumber})` : ""}.`);
    }
    if (id) await db.update(schema.partners).set(values).where(and(eq(schema.partners.id, id), eq(schema.partners.companyId, cid)));
    else await db.insert(schema.partners).values(values);
    revalidatePath(`/c/${cid}/partners`);
    return `/c/${cid}/partners?ok=${encodeURIComponent("Partner mentve.")}`;
  });
}

// --- Gépkocsik -------------------------------------------------------------

export async function saveVehicleAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/vehicles`, async () => {
    const id = intOrNull(fd, "id");
    const pp = str(fd, "purchasePrice");
    const values = {
      companyId: cid,
      make: str(fd, "make"),
      model: str(fd, "model"),
      plate: optStr(fd, "plate")?.toUpperCase() ?? null,
      vin: optStr(fd, "vin")?.toUpperCase() ?? null,
      year: intOrNull(fd, "year"),
      vatTreatment: (str(fd, "vatTreatment") || "margin") as "margin" | "normal",
      purchasePrice: pp === "" ? null : parseNumber(pp),
      note: optStr(fd, "note"),
      eprCategory: optStr(fd, "eprCategory"),
      eprDrive: optStr(fd, "eprDrive"),
      eprMassKg: intOrNull(fd, "eprMassKg"),
      eprOrigin: optStr(fd, "eprOrigin"),
    };
    if (!values.make || !values.model) throw new Error("Gyártmány és típus kötelező.");
    if (id) await db.update(schema.vehicles).set(values).where(and(eq(schema.vehicles.id, id), eq(schema.vehicles.companyId, cid)));
    else await db.insert(schema.vehicles).values(values);
    revalidatePath(`/c/${cid}/vehicles`);
    return `/c/${cid}/vehicles?ok=${encodeURIComponent("Gépkocsi mentve.")}`;
  });
}

// --- Számlatükör -----------------------------------------------------------

export async function saveAccountAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/accounts`, async () => {
    const id = intOrNull(fd, "id");
    if (id) {
      await db
        .update(schema.accounts)
        .set({ name: str(fd, "name"), isActive: fd.get("isActive") === "on" })
        .where(and(eq(schema.accounts.id, id), eq(schema.accounts.companyId, cid)));
    } else {
      const code = str(fd, "code");
      if (!/^\d{1,12}$/.test(code)) throw new Error("A számlaszám csak számjegyekből állhat.");
      await db.insert(schema.accounts).values({
        companyId: cid,
        code,
        name: str(fd, "name"),
        type: str(fd, "type") as "asset",
        isPosting: code.length > 1,
        reportLine: optStr(fd, "reportLine"),
        currency: (str(fd, "currency") || "HUF").toUpperCase(),
      });
    }
    revalidatePath(`/c/${cid}/accounts`);
    return `/c/${cid}/accounts?ok=${encodeURIComponent("Főkönyvi számla mentve.")}`;
  });
}

// --- Számlák ---------------------------------------------------------------

export type ActionResult = { error?: string; id?: number };

export async function saveInvoiceAction(
  cid: number,
  input: InvoiceInput,
  invoiceId?: number,
  postNow = false,
  /** v3.9.0 – a számla-űrlapon felvett új partner; a számlával együtt (egy tranzakcióban) kerül a Partnerek közé. */
  newPartner?: NewPartnerInput | null,
): Promise<ActionResult> {
  const { user } = await requireCompany(cid, { write: true });
  try {
    for (const d of [input.issueDate, input.fulfillmentDate]) if (!isDate(d)) throw new Error("Hiányzó vagy hibás dátum.");
    if (!input.invoiceNumber.trim()) throw new Error("A számlaszám kötelező.");
    const np = newPartner ? cleanPartnerInput(newPartner) : null;
    if (!np && !input.partnerId) throw new Error("Partnert kell választani.");
    const id = await db.transaction(async (tx) => {
      let partnerId = input.partnerId;
      if (np) {
        const existing = await tx.select().from(schema.partners).where(eq(schema.partners.companyId, cid));
        const dup = findDuplicatePartner(existing, np);
        partnerId = dup ? dup.id : (await tx.insert(schema.partners).values({ companyId: cid, ...np }).returning({ id: schema.partners.id }))[0].id;
      }
      return saveInvoiceDraft(cid, { ...input, partnerId }, invoiceId, tx);
    });
    if (np) revalidatePath(`/c/${cid}/partners`);
    if (postNow) {
      const [cur] = await db.select({ r: schema.invoices.reuseEntryNumber }).from(schema.invoices).where(eq(schema.invoices.id, id));
      await postInvoice(cid, id, user.id);
      if (cur?.r) await logInvoiceRepost(cid, id, user.id);
    }
    revalidatePath(`/c/${cid}/invoices`);
    return { id };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function postInvoiceAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`/c/${cid}/invoices/${id}`, async () => {
    const [cur] = await db.select({ r: schema.invoices.reuseEntryNumber }).from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.companyId, cid)));
    await postInvoice(cid, id, user.id);
    if (cur?.r) await logInvoiceRepost(cid, id, user.id);
    return `/c/${cid}/invoices/${id}?ok=${encodeURIComponent("Számla könyvelve.")}`;
  });
}

export async function cancelInvoiceAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`/c/${cid}/invoices/${id}`, async () => {
    const date = str(fd, "date") || today();
    const rev = await cancelInvoice(cid, id, date, user.id);
    return rev ? `/c/${cid}/invoices/${id}?ok=${encodeURIComponent("Számla sztornózva.")}` : `/c/${cid}/invoices?ok=${encodeURIComponent("Piszkozat törölve.")}`;
  });
}

/** v3.9.4 – Piszkozat rontottnak (érvénytelenített papírszámla) jelölése / visszavonása. */
export async function voidInvoiceAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`/c/${cid}/invoices/${id}`, async () => {
    const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.companyId, cid)));
    if (!inv) throw new Error("A számla nem található.");
    if (inv.status !== "draft") throw new Error("Csak piszkozat jelölhető rontottnak (könyvelt számlát sztornózni kell).");
    const on = fd.get("on") === "1";
    await db.update(schema.invoices).set({ voidedAt: on ? new Date() : null }).where(eq(schema.invoices.id, id));
    revalidatePath(`/c/${cid}/invoices`);
    return `/c/${cid}/invoices/${id}?ok=${encodeURIComponent(on ? "Rontottnak jelölve – nem könyvelendő, nem teendő." : "Rontott jelölés visszavonva.")}`;
  });
}

/** Könyvelt számla tételmegnevezésének javítása (összeg nem változik), naplózva. */
export async function renameInvoiceLineAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`/c/${cid}/invoices/${id}`, async () => {
    await renameInvoiceLine(cid, id, Number(fd.get("lineId")), user.id, str(fd, "description"));
    revalidatePath(`/c/${cid}/invoices/${id}`);
    return `/c/${cid}/invoices/${id}?ok=${encodeURIComponent("Tétel megnevezése javítva.")}`;
  });
}

export async function payInvoiceAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`/c/${cid}/invoices/${id}`, async () => {
    await payInvoice(
      cid,
      id,
      {
        date: str(fd, "date"),
        moneyAccountId: Number(fd.get("moneyAccountId")),
        amountFx: parseNumber(fd.get("amountFx")),
        moneyHuf: parseNumber(fd.get("moneyHuf")) || null,
        fxRate: parseNumber(fd.get("fxRate")) || null,
        note: optStr(fd, "note"),
      },
      user.id,
    );
    return `/c/${cid}/invoices/${id}?ok=${encodeURIComponent("Pénzügyi rendezés könyvelve.")}`;
  });
}

/** Könyvelt számla újranyitása javításra (piszkozat lesz, újrakönyveléskor ugyanazt a tételszámot kapja). */
export async function reopenInvoiceAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`/c/${cid}/invoices/${id}`, async () => {
    await reopenInvoice(cid, id, user.id);
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/invoices/${id}/edit`;
  });
}

/** Pénzügyi rendezés javítása (dátum, pénzeszköz, összeg). */
export async function editPaymentAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("invoiceId"));
  await runOrRedirect(`/c/${cid}/invoices/${id}`, async () => {
    await editPayment(cid, Number(fd.get("paymentId")), user.id, {
      date: str(fd, "date"),
      moneyAccountId: Number(fd.get("moneyAccountId")),
      amountFx: parseNumber(fd.get("amountFx")),
      moneyHuf: parseNumber(fd.get("moneyHuf")) || null,
      fxRate: parseNumber(fd.get("fxRate")) || null,
      note: optStr(fd, "note"),
    });
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/invoices/${id}?ok=${encodeURIComponent("Rendezés javítva.")}`;
  });
}

export async function reversePaymentAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("invoiceId"));
  await runOrRedirect(`/c/${cid}/invoices/${id}`, async () => {
    await reversePayment(cid, Number(fd.get("paymentId")), str(fd, "date") || today(), user.id);
    return `/c/${cid}/invoices/${id}?ok=${encodeURIComponent("Rendezés sztornózva.")}`;
  });
}

// --- Párosítás, beszámítás (v2.2) -------------------------------------------

export async function linkEntryAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`/c/${cid}/invoices/${id}`, async () => {
    const r = await linkEntryToInvoice(cid, id, Number(fd.get("entryId")), parseNumber(fd.get("amount")) || null);
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/invoices/${id}?ok=${encodeURIComponent(`Párosítva: ${r.number} (${r.amount} Ft).`)}`;
  });
}

export async function offsetInvoiceAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  await runOrRedirect(`/c/${cid}/invoices/${id}`, async () => {
    const date = str(fd, "date");
    if (!isDate(date)) throw new Error("Hibás dátum.");
    const e = await offsetInvoices(cid, id, Number(fd.get("otherId")), date, parseNumber(fd.get("amount")) || null, user.id);
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/invoices/${id}?ok=${encodeURIComponent(`Beszámítás könyvelve: ${e.number}.`)}`;
  });
}

// --- ÁFA-zárás, elhatárolások (v2.2) ------------------------------------------

export async function closeVatAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const back = `/c/${cid}/reports/vat/closing?year=${str(fd, "to").slice(0, 4)}`;
  await runOrRedirect(back, async () => {
    const r = await closeVatPeriod(cid, str(fd, "from"), str(fd, "to"), user.id);
    revalidatePath(`/c/${cid}`, "layout");
    return `${back}&ok=${encodeURIComponent(`ÁFA-zárás könyvelve: ${r.entry.number} – ${r.net >= 0 ? "fizetendő" : "visszaigényelhető"} ${Math.abs(r.net)} Ft (468).`)}`;
  });
}

export async function reopenVatAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const back = `/c/${cid}/reports/vat/closing?year=${str(fd, "year")}`;
  await runOrRedirect(back, async () => {
    await reopenVatPeriod(cid, Number(fd.get("closingId")), user.id);
    revalidatePath(`/c/${cid}`, "layout");
    return `${back}&ok=${encodeURIComponent("ÁFA-zárás visszavonva (storno).")}`;
  });
}

export async function releaseAccrualAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const back = `/c/${cid}/closing/accruals`;
  await runOrRedirect(back, async () => {
    const date = str(fd, "date");
    if (!isDate(date)) throw new Error("Hibás dátum.");
    const e = await releaseAccrual(cid, Number(fd.get("entryId")), date, user.id);
    revalidatePath(`/c/${cid}`, "layout");
    return `${back}?ok=${encodeURIComponent(`Elhatárolás feloldva: ${e.number}.`)}`;
  });
}

// --- Vegyes napló ----------------------------------------------------------

export async function manualEntryAction(
  cid: number,
  input: { journalCode: string; date: string; description: string; lines: DraftLine[] },
): Promise<ActionResult> {
  const { user } = await requireCompany(cid, { write: true });
  try {
    if (!isDate(input.date)) throw new Error("Hibás dátum.");
    if (!input.description.trim()) throw new Error("A megnevezés kötelező.");
    const e = await manualEntry(cid, input, user.id);
    revalidatePath(`/c/${cid}/journal`);
    return { id: e.id };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function reverseEntryAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/journal`, async () => {
    const entryId = Number(fd.get("entryId"));
    const [e] = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, cid)));
    if (e?.sourceType !== "manual" && e?.sourceType !== "member_loan") throw new Error("Számlából / rendezésből származó tételt a számlánál lehet sztornózni.");
    await db.transaction((tx) => reverseEntry(tx, cid, entryId, str(fd, "date") || today(), user.id));
    return `/c/${cid}/journal?ok=${encodeURIComponent("Tétel sztornózva.")}`;
  });
}

/** Napló-tétel „ellenőrzött” jelölése be / ki. */
export async function toggleEntryCheckAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const back = str(fd, "back") || `/c/${cid}/journal`;
  await runOrRedirect(back, async () => {
    await setEntryChecked(cid, Number(fd.get("entryId")), user.id, str(fd, "on") === "1");
    revalidatePath(`/c/${cid}/journal`, "layout");
    return back;
  });
}

/** Kézi tétel teljes javítása (dátum, megnevezés, sorok). Sor mezők: `${key}:mező`, a `row` mezők sorolják a sorokat. */
export async function updateManualEntryAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const entryId = Number(fd.get("entryId"));
  await runOrRedirect(`/c/${cid}/journal/${entryId}/edit`, async () => {
    if (!isDate(str(fd, "date"))) throw new Error("Hibás dátum.");
    const lines: EntryLineInput[] = [];
    for (const k of [...new Set(fd.getAll("row").map(String))]) {
      const g = (f: string) => fd.get(`${k}:${f}`);
      const accountId = Number(g("accountId")) || 0;
      const debit = parseNumber(g("debit")) || 0, credit = parseNumber(g("credit")) || 0;
      const id = k.startsWith("l") ? Number(k.slice(1)) : null;
      if (!id && !accountId && !debit && !credit) continue; // üres új sor
      if (!accountId && (debit || credit)) throw new Error("Minden összeges sorhoz főkönyvi számla kell.");
      lines.push({
        id, remove: g("remove") === "1", accountId, debit, credit,
        amountFx: parseNumber(g("amountFx")) || null,
        description: optStr(fd, `${k}:description`),
        partnerId: intOrNull(fd, `${k}:partnerId`),
        vehicleId: intOrNull(fd, `${k}:vehicleId`),
      });
    }
    const n = await updateManualEntry(cid, entryId, user.id, { date: str(fd, "date"), description: str(fd, "description"), lines });
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/journal/${entryId}/edit?ok=${encodeURIComponent(n ? `${n} módosítás mentve.` : "Nem történt változás.")}`;
  });
}

/** Lekönyvelt kézi tétel kiegészítő adatainak (megnevezés, sorszöveg, partner, gépkocsi) módosítása. */
export async function updateEntryMetaAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const entryId = Number(fd.get("entryId"));
  await runOrRedirect(`/c/${cid}/journal/${entryId}/edit`, async () => {
    const lineIds = fd.getAll("lineId").map(Number);
    const n = await updateEntryMeta(cid, entryId, user.id, {
      description: str(fd, "description"),
      lines: lineIds.map((id) => ({
        id,
        description: optStr(fd, `desc_${id}`),
        partnerId: intOrNull(fd, `partner_${id}`),
        vehicleId: intOrNull(fd, `vehicle_${id}`),
      })),
    });
    revalidatePath(`/c/${cid}/journal`);
    return `/c/${cid}/journal/${entryId}/edit?ok=${encodeURIComponent(n ? `${n} módosítás mentve.` : "Nem történt változás.")}`;
  });
}

// --- Beállítások -----------------------------------------------------------

export async function updateCompanyAction(fd: FormData) {
  const cid = cidOf(fd);
  const { role } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/settings`, async () => {
    if (role !== "owner") throw new Error("Csak tulajdonos módosíthatja a cégadatokat.");
    const [cur] = await db.select({ settings: schema.companies.settings }).from(schema.companies).where(eq(schema.companies.id, cid));
    await db
      .update(schema.companies)
      .set({
        settings: {
          ...cur.settings, representative: optStr(fd, "representative"), representativeTitle: optStr(fd, "representativeTitle"), signPlace: optStr(fd, "signPlace"),
          // EPR mezők csak társaságnál szerepelnek az űrlapon – magánszemélynél a meglévő érték marad.
          ...(fd.has("eprOriginDigit") ? { eprFlatRate: fd.get("eprFlatRate") === "on", eprOriginDigit: optStr(fd, "eprOriginDigit") } : {}),
          ...(fd.has("operationStart") ? { operationStart: /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("operationStart"))) ? String(fd.get("operationStart")) : null } : {}),
        },
        name: str(fd, "name"),
        taxNumber: optStr(fd, "taxNumber"),
        euVatNumber: optStr(fd, "euVatNumber"),
        registrationNumber: optStr(fd, "registrationNumber"),
        address: optStr(fd, "address"),
        vatPeriod: str(fd, "vatPeriod") as "monthly",
        fiscalYearStartMonth: Number(fd.get("fiscalYearStartMonth")) || 1,
      })
      .where(eq(schema.companies.id, cid));
    return `/c/${cid}/settings?ok=${encodeURIComponent("Cégadatok mentve.")}`;
  });
}

/** v2.0 – Magánszemély adózási profiljának mentése. */
export async function updateTaxProfileAction(fd: FormData) {
  const cid = cidOf(fd);
  const { role, company } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/settings`, async () => {
    if (role !== "owner") throw new Error("Csak tulajdonos módosíthatja az adózási profilt.");
    if (!isPrivate(company)) throw new Error("Adózási profil csak adószámos magánszemélynél van.");
    const profile = taxProfileFromForm(fd, company.taxProfile ?? DEFAULT_TAX_PROFILE);
    await db.update(schema.companies).set({ taxProfile: profile }).where(eq(schema.companies.id, cid));
    return `/c/${cid}/settings?ok=${encodeURIComponent("Adózási profil mentve.")}`;
  });
}

/** v2.0 – P&L: melyik csatorna TFH / IFA-ja kerüljön az eredménybe. */
export async function setPnlTaxIncludeAction(fd: FormData) {
  const cid = cidOf(fd);
  const { company } = await requireCompany(cid, { write: true });
  const year = str(fd, "year");
  const rawBack = str(fd, "back");
  const back = rawBack === `/c/${cid}` || rawBack.startsWith(`/c/${cid}/`) || rawBack.startsWith(`/c/${cid}?`) ? rawBack : "";
  await runOrRedirect(back || `/c/${cid}/taxes?year=${year}`, async () => {
    if (!isPrivate(company)) throw new Error("Csak adószámos magánszemélynél.");
    const inc = str(fd, "include");
    if (!["both", "platform", "direct", "none"].includes(inc)) throw new Error("Ismeretlen beállítás.");
    const profile = { ...(company.taxProfile ?? DEFAULT_TAX_PROFILE), pnlTaxInclude: inc as "both" | "platform" | "direct" | "none" };
    await db.update(schema.companies).set({ taxProfile: profile }).where(eq(schema.companies.id, cid));
    revalidatePath(`/c/${cid}`, "layout");
    if (back) return back;
    return `/c/${cid}/taxes?year=${year}#pnl`;
  });
}

/** v2.0 – IFA adatai: tarifa, átlagos vendégszám, éves vendégéjszakák csatornánként (üres = becslés a számlákból). */
export async function saveIfaInputsAction(fd: FormData) {
  const cid = cidOf(fd);
  const { company } = await requireCompany(cid, { write: true });
  const year = str(fd, "year");
  await runOrRedirect(`/c/${cid}/taxes?year=${year}`, async () => {
    if (!isPrivate(company)) throw new Error("Csak adószámos magánszemélynél.");
    if (!/^\d{4}$/.test(year)) throw new Error("Hibás év.");
    const num = (k: string) => {
      const v = str(fd, k).replace(/\s/g, "").replace(",", ".");
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error("Csak nem negatív szám adható meg.");
      return n;
    };
    const prev = company.taxProfile ?? DEFAULT_TAX_PROFILE;
    const nights = { ...(prev.ifaNights ?? {}) };
    nights[year] = { platform: num("nightsPlatform"), direct: num("nightsDirect") };
    const profile = { ...prev, ifaPerNight: num("ifaPerNight"), ifaAvgGuests: num("ifaAvgGuests"), ifaNights: nights };
    await db.update(schema.companies).set({ taxProfile: profile }).where(eq(schema.companies.id, cid));
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/taxes?year=${year}&ok=${encodeURIComponent("IFA-adatok mentve.")}#ifa`;
  });
}

export async function lockPeriodAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user, role } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/settings`, async () => {
    const [y, m] = str(fd, "period").split("-").map(Number);
    if (!y || !m) throw new Error("Válassz időszakot.");
    if (fd.get("unlock") === "1") {
      if (role !== "owner") throw new Error("Időszakot csak tulajdonos nyithat vissza.");
      await unlockPeriod(cid, y, m);
    } else await lockPeriod(cid, y, m, user.id);
    return `/c/${cid}/settings?ok=${encodeURIComponent("Időszak frissítve.")}`;
  });
}

// --- Árfolyamok -------------------------------------------------------------

/** Kliens oldali előnézethez: adott napon érvényes MNB árfolyam. */
export async function getRateAction(cid: number, currency: string, date: string): Promise<{ rate?: number; rateDate?: string; error?: string }> {
  await requireCompany(cid);
  try {
    if (!isDate(date)) throw new Error("Hibás dátum.");
    return await getMnbRate(currency, date);
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function refreshRatesAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/fx`, async () => {
    const to = str(fd, "to") || today();
    const from = str(fd, "from") || addDays(to, -31);
    const cur = (str(fd, "currencies") || "EUR,USD,CHF,GBP").toUpperCase().split(/[ ,;]+/).filter(Boolean);
    const rates = await fetchMnbRates(from, to, cur);
    await storeRates(db, rates);
    return `/c/${cid}/fx?ok=${encodeURIComponent(`${rates.length} árfolyam letöltve az MNB-től.`)}`;
  });
}

export async function manualRateAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/fx`, async () => {
    const date = str(fd, "date");
    const currency = str(fd, "currency").toUpperCase();
    const rate = parseNumber(fd.get("rate"));
    if (!isDate(date) || !/^[A-Z]{3}$/.test(currency) || !(rate > 0)) throw new Error("Dátum, devizanem és pozitív árfolyam kell.");
    await storeRates(db, [{ date, currency, rate }], "manual");
    return `/c/${cid}/fx?ok=${encodeURIComponent("Árfolyam rögzítve.")}`;
  });
}

// --- Megjelenés ---------------------------------------------------------------

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const LOGO_MAX = 400 * 1024;

export async function saveThemeAction(fd: FormData) {
  const cid = cidOf(fd);
  const { role } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/appearance`, async () => {
    if (role !== "owner") throw new Error("A megjelenést csak tulajdonos módosíthatja.");
    const presetKey = str(fd, "preset");
    const preset = PRESETS.find((p) => p.preset === presetKey);
    const theme = preset
      ? { preset: preset.preset, accent: preset.accent, sidebar: preset.sidebar, mode: preset.mode }
      : { preset: "custom", accent: str(fd, "accent"), sidebar: str(fd, "sidebar"), mode: (str(fd, "mode") === "dark" ? "dark" : "light") as "light" | "dark" };
    if (!isHex(theme.accent) || !isHex(theme.sidebar)) throw new Error("Érvénytelen szín.");
    await db.update(schema.companies).set({ theme }).where(eq(schema.companies.id, cid));
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/appearance?ok=${encodeURIComponent(preset ? `Téma alkalmazva: ${preset.name}` : "Egyedi színek mentve.")}`;
  });
}

export async function uploadLogoAction(fd: FormData) {
  const cid = cidOf(fd);
  const { role } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/appearance`, async () => {
    if (role !== "owner") throw new Error("A logót csak tulajdonos módosíthatja.");
    const file = fd.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new Error("Válassz ki egy képfájlt.");
    if (!LOGO_TYPES.includes(file.type)) throw new Error("Csak PNG, JPG, WebP vagy SVG logó tölthető fel.");
    if (file.size > LOGO_MAX) throw new Error("A logó legfeljebb 400 KB lehet.");
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    await db.update(schema.companies).set({ logoData: data, logoMime: file.type, logoUpdatedAt: new Date() }).where(eq(schema.companies.id, cid));
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/appearance?ok=${encodeURIComponent("Logó feltöltve.")}`;
  });
}

export async function removeLogoAction(fd: FormData) {
  const cid = cidOf(fd);
  const { role } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/appearance`, async () => {
    if (role !== "owner") throw new Error("A logót csak tulajdonos módosíthatja.");
    await db.update(schema.companies).set({ logoData: null, logoMime: null, logoUpdatedAt: null }).where(eq(schema.companies.id, cid));
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/appearance?ok=${encodeURIComponent("Logó eltávolítva.")}`;
  });
}

// --- Adatimport ------------------------------------------------------------------

export async function importBundleAction(cid: number, json: string): Promise<{ error?: string; report?: ImportReport }> {
  const { user, role } = await requireCompany(cid, { write: true });
  if (role !== "owner") return { error: "Importálni csak a cég tulajdonosa tud." };
  try {
    const bundle = JSON.parse(json) as ImportBundle;
    const report = await importBundle(cid, bundle, user.id);
    // v2.0 – a csomagba ágyazott vendégház-szinkron (foglalások, értékelések)
    const ghSync = (bundle as { ghSync?: unknown }).ghSync;
    if (ghSync) {
      try {
        const { applySyncBundle, logSync } = await import("@/lib/gh-sync");
        const r = await applySyncBundle(cid, ghSync as Parameters<typeof applySyncBundle>[1]);
        report.counts["foglalás (szinkron)"] = r.reservations;
        report.counts["értékelés"] = r.reviews;
        await logSync(cid, "Airbnb szinkronfájl", true, `${r.reservations} foglalás, ${r.reviews} értékelés betöltve (import csomagból)`);
      } catch (e) {
        report.warnings.push(`A foglalások / értékelések betöltése nem sikerült: ${errMsg(e)}`);
      }
    }
    revalidatePath(`/c/${cid}`, "layout");
    return { report };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

// --- Kiegészítő import (mm-erp-delta/1) -------------------------------------------------

export async function deltaImportAction(cid: number, json: string, fileName: string, apply: boolean): Promise<{ error?: string; report?: DeltaReport }> {
  const { user, role } = await requireCompany(cid, { write: true });
  if (role !== "owner") return { error: "Kiegészítő csomagot csak a cég tulajdonosa tölthet be." };
  try {
    const bundle = parseDelta(json);
    const report = await runDelta(cid, bundle, { dryRun: !apply, userId: user.id, fileName });
    if (report.applied) revalidatePath(`/c/${cid}`, "layout");
    return { report };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

// --- Tagi kölcsön -------------------------------------------------------------------

export async function memberLoanAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/member-loans`, async () => {
    const kind = str(fd, "kind") === "repayment" ? "repayment" : "loan";
    const date = str(fd, "date");
    if (!isDate(date)) throw new Error("Hibás dátum.");
    const entry = await recordMemberLoan(
      cid,
      {
        partnerId: Number(fd.get("partnerId")),
        kind,
        date,
        amount: parseNumber(fd.get("amount")) || null,
        moneyAccountId: Number(fd.get("moneyAccountId")),
        amountFx: parseNumber(fd.get("amountFx")) || null,
        dueDate: kind === "loan" ? str(fd, "dueDate") : null,
        note: optStr(fd, "note"),
        targetLoanEntryId: kind === "repayment" ? Number(fd.get("targetLoanEntryId")) || null : null,
      },
      user.id,
    );
    revalidatePath(`/c/${cid}`, "layout");
    // rögtön a nyomtatható okirat: befizetésnél a szerződés (TK), visszafizetésnél a bizonylat (TKV)
    return `/c/${cid}/member-loans/${entry.id}${kind === "loan" ? "?doc=contract" : ""}`;
  });
}

export async function extendLoanAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/member-loans`, async () => {
    const days = Number(str(fd, "days"));
    const entryId = Number(fd.get("entryId"));
    // v4.5.0 – a módosítás kelte alapból a jelenlegi lejárat napja
    const [term] = await db.select({ due: schema.memberLoanTerms.dueDate }).from(schema.memberLoanTerms).where(and(eq(schema.memberLoanTerms.entryId, entryId), eq(schema.memberLoanTerms.companyId, cid)));
    const on = str(fd, "extendedOn") || term?.due || today();
    if (!isDate(on)) throw new Error("Hibás dátum.");
    const r = await extendLoan(cid, entryId, { days, extendedOn: on, note: optStr(fd, "note") });
    revalidatePath(`/c/${cid}`, "layout");
    // az automatikusan elkészült szerződésmódosítás
    return `/c/${cid}/member-loans/${entryId}?doc=M${r.seq}`;
  });
}

export async function setLoanDueAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/member-loans`, async () => {
    const due = str(fd, "dueDate");
    if (!isDate(due)) throw new Error("Hibás lejárat.");
    await setLoanDueDate(cid, Number(fd.get("entryId")), due);
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/member-loans?ok=${encodeURIComponent("Lejárat megadva – a szerződés elkészült.")}`;
  });
}

export async function undoExtensionAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/member-loans`, async () => {
    await undoLastExtension(cid, Number(fd.get("entryId")));
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/member-loans?ok=${encodeURIComponent("Az utolsó hosszabbítás visszavonva.")}`;
  });
}

export async function revalueMemberLoansAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/member-loans`, async () => {
    const date = str(fd, "date");
    if (!isDate(date)) throw new Error("Hibás dátum.");
    const done = await revalueMemberLoans(cid, date, user.id);
    revalidatePath(`/c/${cid}`, "layout");
    const msg = done.length ? done.map((x) => `${x.member}: ${x.diff > 0 ? "+" : ""}${fmtNum(x.diff)} Ft (${x.currency} ${fmtNum(x.rate)})`).join("; ") : "Nincs könyvelendő különbözet.";
    return `/c/${cid}/member-loans?ok=${encodeURIComponent("Átértékelés: " + msg)}`;
  });
}

export async function importLoanTermsAction(cid: number, json: string): Promise<{ error?: string; added?: number; extensions?: number; repayments?: number; warnings?: string[] }> {
  const { role } = await requireCompany(cid, { write: true });
  if (role !== "owner") return { error: "Ezt csak a cég tulajdonosa teheti meg." };
  try {
    const r = await importLoanTermsOnly(cid, JSON.parse(json) as ImportBundle);
    revalidatePath(`/c/${cid}`, "layout");
    return r;
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function wipeCompanyAction(fd: FormData) {
  const cid = cidOf(fd);
  const { role, company } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/import`, async () => {
    if (role !== "owner") throw new Error("Ezt csak a cég tulajdonosa teheti meg.");
    if (str(fd, "confirm") !== company.name) throw new Error(`A törléshez pontosan be kell írni a cég nevét: ${company.name}`);
    await wipeCompanyData(cid);
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/import?ok=${encodeURIComponent("A cég könyvelési adatai törölve. Most újra importálhatsz.")}`;
  });
}

// --- Számla-ellenőrzés --------------------------------------------------------

/** Ellenőrizve pipa be/ki – a pipa a számla aktuális ujjlenyomatával mentődik. */
export async function toggleInvoiceCheckAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const back = str(fd, "back") || `/c/${cid}/invoices`;
  await runOrRedirect(back, async () => {
    const id = Number(fd.get("id"));
    const [a] = await invoiceAudit(cid, { ids: [id] });
    if (!a) throw new Error("A számla nem található.");
    const on = str(fd, "on") === "1";
    const values = { companyId: cid, checkedAt: on ? new Date() : null, checkedBy: on ? user.id : null, fingerprint: on ? a.fingerprint : null, updatedAt: new Date() };
    await db.insert(schema.invoiceChecks).values({ invoiceId: id, ...values }).onConflictDoUpdate({ target: schema.invoiceChecks.invoiceId, set: values });
    revalidatePath(`/c/${cid}/invoices`, "layout");
    return back;
  });
}

/** Ellenőrzési megjegyzés és bizonylat-hivatkozás mentése. */
export async function saveInvoiceCheckNoteAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  const id = Number(fd.get("id"));
  const back = `/c/${cid}/invoices/${id}`;
  await runOrRedirect(back, async () => {
    const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.companyId, cid)));
    if (!inv) throw new Error("A számla nem található.");
    const docUrl = optStr(fd, "docUrl");
    if (docUrl && !/^https?:\/\//i.test(docUrl)) throw new Error("A bizonylat hivatkozása http(s):// címmel kezdődjön.");
    const values = { companyId: cid, note: optStr(fd, "note"), docUrl, updatedAt: new Date() };
    await db.insert(schema.invoiceChecks).values({ invoiceId: id, ...values }).onConflictDoUpdate({ target: schema.invoiceChecks.invoiceId, set: values });
    revalidatePath(`/c/${cid}/invoices`, "layout");
    return `${back}?ok=${encodeURIComponent("Ellenőrzési adatok mentve.")}`;
  });
}

// --- v4.5.0 – Tagok és tisztségviselők ---------------------------------------------------------

export async function saveCompanyMemberAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/settings?member=${str(fd, "id") || "new"}#tagok`, async () => {
    const num = (k: string) => { const v = str(fd, k); return v === "" ? null : parseNumber(v); };
    const date = (k: string) => { const v = str(fd, k); if (v && !isDate(v)) throw new Error("Hibás dátum."); return v || null; };
    const rep = str(fd, "representation");
    const id = await saveMember(cid, intOrNull(fd, "id"), {
      name: str(fd, "name"),
      partnerId: intOrNull(fd, "partnerId"),
      isMember: fd.get("isMember") === "on",
      isCeo: fd.get("isCeo") === "on",
      sharePct: num("sharePct"),
      capital: num("capital"),
      startDate: date("startDate"),
      endDate: date("endDate"),
      representation: rep === "önálló" || rep === "együttes" ? rep : null,
      birthPlace: optStr(fd, "birthPlace"),
      birthDate: date("birthDate"),
      motherName: optStr(fd, "motherName"),
      address: optStr(fd, "address"),
      taxId: optStr(fd, "taxId"),
      note: optStr(fd, "note"),
    });
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/settings?member=${id}&ok=${encodeURIComponent("Mentve")}#tagok`;
  });
}

export async function deleteCompanyMemberAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/settings#tagok`, async () => {
    await deleteMember(cid, Number(fd.get("id")));
    revalidatePath(`/c/${cid}`, "layout");
    return `/c/${cid}/settings?ok=${encodeURIComponent("Törölve")}#tagok`;
  });
}
