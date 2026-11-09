"use server";

import { revalidatePath } from "next/cache";
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
import { parseNumber } from "@/lib/money";
import { isDate, today } from "@/lib/dates";
import type { DraftLine } from "@/lib/posting";
import { getMnbRate, storeRates, fetchMnbRates } from "@/lib/fx-service";
import { addDays } from "@/lib/fx";

const cidOf = (fd: FormData) => Number(fd.get("cid"));

// --- Partnerek -------------------------------------------------------------

export async function savePartnerAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/partners`, async () => {
    const id = intOrNull(fd, "id");
    const values = {
      companyId: cid,
      name: str(fd, "name"),
      taxNumber: optStr(fd, "taxNumber"),
      euVatNumber: optStr(fd, "euVatNumber"),
      country: (str(fd, "country") || "HU").toUpperCase(),
      address: optStr(fd, "address"),
      email: optStr(fd, "email"),
      isPrivatePerson: fd.get("isPrivatePerson") === "on",
      note: optStr(fd, "note"),
    };
    if (!values.name) throw new Error("A partner neve kötelező.");
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

export async function saveInvoiceAction(cid: number, input: InvoiceInput, invoiceId?: number, postNow = false): Promise<ActionResult> {
  const { user } = await requireCompany(cid, { write: true });
  try {
    for (const d of [input.issueDate, input.fulfillmentDate]) if (!isDate(d)) throw new Error("Hiányzó vagy hibás dátum.");
    if (!input.invoiceNumber.trim()) throw new Error("A számlaszám kötelező.");
    if (!input.partnerId) throw new Error("Partnert kell választani.");
    const id = await saveInvoiceDraft(cid, input, invoiceId);
    if (postNow) await postInvoice(cid, id, user.id);
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
    await postInvoice(cid, id, user.id);
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

export async function reversePaymentAction(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true });
  const id = Number(fd.get("invoiceId"));
  await runOrRedirect(`/c/${cid}/invoices/${id}`, async () => {
    await reversePayment(cid, Number(fd.get("paymentId")), str(fd, "date") || today(), user.id);
    return `/c/${cid}/invoices/${id}?ok=${encodeURIComponent("Rendezés sztornózva.")}`;
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
    if (e?.sourceType !== "manual") throw new Error("Számlából / rendezésből származó tételt a számlánál lehet sztornózni.");
    await db.transaction((tx) => reverseEntry(tx, cid, entryId, str(fd, "date") || today(), user.id));
    return `/c/${cid}/journal?ok=${encodeURIComponent("Tétel sztornózva.")}`;
  });
}

// --- Beállítások -----------------------------------------------------------

export async function updateCompanyAction(fd: FormData) {
  const cid = cidOf(fd);
  const { role } = await requireCompany(cid, { write: true });
  await runOrRedirect(`/c/${cid}/settings`, async () => {
    if (role !== "owner") throw new Error("Csak tulajdonos módosíthatja a cégadatokat.");
    await db
      .update(schema.companies)
      .set({
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
