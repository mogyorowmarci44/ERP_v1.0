"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect, str, optStr, intOrNull } from "@/lib/action-utils";
import { parseNumber } from "@/lib/money";
import { isDate, today } from "@/lib/dates";
import { getForecastSettings, saveForecastSettings, loadPlans, soldHistory, suggestSale, costSuggestions, calibrationFor, vehicleLabel } from "@/lib/forecast-data";
import { DEFAULT_FORECAST_SETTINGS } from "@/lib/forecast";

const { forecastPlans, forecastPlanCosts, forecastItems, vehicles } = schema;
const cidOf = (fd: FormData) => Number(fd.get("cid"));
const back = (cid: number, page: string) => `/c/${cid}/forecast${page ? `/${page}` : ""}`;
const ok = (cid: number, page: string, msg: string) => `${back(cid, page)}?ok=${encodeURIComponent(msg)}`;
const chan = (v: string) => (v === "cash" ? "cash" : "bank");
const dateOrNull = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return null;
  if (!isDate(v)) throw new Error(`Hibás dátum: ${v}`);
  return v;
};
const moneyOrNull = (fd: FormData, k: string) => (str(fd, k) === "" ? null : parseNumber(fd.get(k)));
const refresh = (cid: number) => revalidatePath(`/c/${cid}/forecast`, "layout");

async function ownPlan(cid: number, planId: number) {
  const [p] = await db.select().from(forecastPlans).where(and(eq(forecastPlans.id, planId), eq(forecastPlans.companyId, cid)));
  if (!p) throw new Error("A terv nem található.");
  return p;
}

// --- Eladási tervek ---------------------------------------------------------

export async function savePlanAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "stock"), async () => {
    const planId = intOrNull(fd, "planId");
    const vehicleId = intOrNull(fd, "vehicleId");
    const values = {
      companyId: cid,
      label: optStr(fd, "label"),
      purchaseDate: dateOrNull(fd, "purchaseDate"),
      purchasePrice: moneyOrNull(fd, "purchasePrice"),
      purchasePayment: chan(str(fd, "purchasePayment") || "cash"),
      salePrice: moneyOrNull(fd, "salePrice"),
      saleDate: dateOrNull(fd, "saleDate"),
      salePayment: chan(str(fd, "salePayment")),
      note: optStr(fd, "note"),
      updatedAt: new Date(),
    };
    if (values.salePrice !== null && values.salePrice <= 0) throw new Error("Az eladási ár legyen pozitív.");
    if (!vehicleId && !planId && (!values.purchaseDate || !values.purchasePrice)) throw new Error("Tervezett beszerzésnél a vételár és a dátum kötelező.");
    if (planId) {
      await ownPlan(cid, planId);
      await db.update(forecastPlans).set(values).where(eq(forecastPlans.id, planId));
    } else if (vehicleId) {
      const [v] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, cid)));
      if (!v) throw new Error("A gépkocsi nem található.");
      await db.insert(forecastPlans).values({ ...values, vehicleId }).onConflictDoUpdate({ target: forecastPlans.vehicleId, set: values });
    } else {
      await db.insert(forecastPlans).values({ ...values, label: values.label ?? "Tervezett beszerzés" });
    }
    refresh(cid);
    return ok(cid, "stock", "Terv mentve.");
  });
}

export async function deletePlanAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "stock"), async () => {
    const id = Number(fd.get("planId"));
    await ownPlan(cid, id);
    await db.delete(forecastPlans).where(eq(forecastPlans.id, id));
    refresh(cid);
    return ok(cid, "stock", "Terv törölve.");
  });
}

/** Tervezett beszerzés összekapcsolása a ténylegesen megvett gépkocsival. */
export async function linkPlanAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "stock"), async () => {
    const id = Number(fd.get("planId"));
    const vehicleId = Number(fd.get("vehicleId"));
    await ownPlan(cid, id);
    const [v] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, cid)));
    if (!v) throw new Error("A gépkocsi nem található.");
    const [existing] = await db.select().from(forecastPlans).where(eq(forecastPlans.vehicleId, vehicleId));
    if (existing) throw new Error("Ehhez a gépkocsihoz már van terv – azt szerkeszd, vagy töröld előbb.");
    await db.update(forecastPlans).set({ vehicleId, purchaseDate: null, purchasePrice: null, label: vehicleLabel(v), updatedAt: new Date() }).where(eq(forecastPlans.id, id));
    refresh(cid);
    return ok(cid, "stock", "A terv a gépkocsihoz kapcsolva.");
  });
}

export async function addPlanCostAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "stock"), async () => {
    let planId = intOrNull(fd, "planId");
    const vehicleId = intOrNull(fd, "vehicleId");
    if (!planId && vehicleId) {
      const [v] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, cid)));
      if (!v) throw new Error("A gépkocsi nem található.");
      const [p] = await db.insert(forecastPlans).values({ companyId: cid, vehicleId }).onConflictDoNothing().returning({ id: forecastPlans.id });
      planId = p?.id ?? (await db.select().from(forecastPlans).where(eq(forecastPlans.vehicleId, vehicleId)))[0].id;
    }
    if (!planId) throw new Error("Hiányzó terv.");
    await ownPlan(cid, planId);
    const net = parseNumber(fd.get("net"));
    if (!(net > 0)) throw new Error("A nettó összeg legyen pozitív.");
    await db.insert(forecastPlanCosts).values({
      planId,
      description: str(fd, "description") || "Költség",
      date: dateOrNull(fd, "date"),
      net,
      vatRate: Number(fd.get("vatRate") ?? 27),
      deductible: fd.get("deductible") !== "no",
      capitalize: fd.get("capitalize") !== "no",
      payment: chan(str(fd, "payment") || "cash"),
    });
    refresh(cid);
    return ok(cid, "stock", "Költség hozzáadva.");
  });
}

export async function deletePlanCostAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "stock"), async () => {
    const id = Number(fd.get("costId"));
    const [c] = await db.select().from(forecastPlanCosts).where(eq(forecastPlanCosts.id, id));
    if (!c) throw new Error("A költség nem található.");
    await ownPlan(cid, c.planId);
    await db.delete(forecastPlanCosts).where(eq(forecastPlanCosts.id, id));
    refresh(cid);
    return ok(cid, "stock", "Költség törölve.");
  });
}

/** A terv nélküli készletautókra javasolt ár és dátum a múltbeli eladások mediánja alapján. */
export async function fillSuggestionsAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "stock"), async () => {
    const [{ stock }, hist] = await Promise.all([loadPlans(cid), soldHistory(cid)]);
    let n = 0;
    for (const s of stock) {
      if (s.plan?.salePrice && s.plan?.saleDate) continue;
      const sug = suggestSale(s.bookValue, s.vehicle.purchaseDate, hist);
      const set = { salePrice: sug.price, saleDate: sug.date, note: `Javaslat: ${sug.basis}`, updatedAt: new Date() };
      if (s.plan) await db.update(forecastPlans).set(set).where(eq(forecastPlans.id, s.plan.id));
      else await db.insert(forecastPlans).values({ companyId: cid, vehicleId: s.vehicle.id, ...set });
      n++;
    }
    refresh(cid);
    return ok(cid, "stock", n ? `${n} autóra kitöltve a javaslat – nézd át és írd át, ahol kell.` : "Minden autónak van már terve.");
  });
}

// --- Költségtételek ------------------------------------------------------------

const CATEGORIES = new Set(["expense", "asset", "loan_in", "loan_out", "capital_in", "dividend", "other_in", "other_out"]);
const FREQS = new Set(["once", "monthly", "quarterly", "yearly"]);

export async function saveItemAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "costs"), async () => {
    const id = intOrNull(fd, "id");
    const category = str(fd, "category");
    const frequency = str(fd, "frequency");
    const startDate = dateOrNull(fd, "startDate") ?? today();
    const values = {
      companyId: cid,
      category: CATEGORIES.has(category) ? category : "expense",
      description: str(fd, "description") || "Tétel",
      accountCode: optStr(fd, "accountCode"),
      partnerName: optStr(fd, "partnerName"),
      net: parseNumber(fd.get("net")),
      vatRate: Number(fd.get("vatRate") ?? 0),
      deductible: fd.get("deductible") !== "no",
      frequency: FREQS.has(frequency) ? frequency : "monthly",
      startDate,
      endDate: dateOrNull(fd, "endDate"),
      payment: chan(str(fd, "payment")),
    };
    if (!(values.net > 0)) throw new Error("Az összeg legyen pozitív.");
    if (id) {
      const [it] = await db.select().from(forecastItems).where(and(eq(forecastItems.id, id), eq(forecastItems.companyId, cid)));
      if (!it) throw new Error("A tétel nem található.");
      await db.update(forecastItems).set(values).where(eq(forecastItems.id, id));
    } else await db.insert(forecastItems).values(values);
    refresh(cid);
    return ok(cid, "costs", "Tétel mentve.");
  });
}

export async function deleteItemAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "costs"), async () => {
    await db.delete(forecastItems).where(and(eq(forecastItems.id, Number(fd.get("id"))), eq(forecastItems.companyId, cid)));
    refresh(cid);
    return ok(cid, "costs", "Tétel törölve.");
  });
}

/** Ismétlődő költség-javaslat(ok) felvétele (egy vagy az összes). */
export async function acceptSuggestionsAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "costs"), async () => {
    const keys = new Set(fd.getAll("key").map(String));
    const all = await costSuggestions(cid);
    const existing = await db.select().from(forecastItems).where(and(eq(forecastItems.companyId, cid), eq(forecastItems.source, "suggested")));
    const start = (() => { const t = today(); return t.slice(0, 8) + "15" < t ? `${nextMonth(t)}-15` : t.slice(0, 8) + "15"; })();
    let n = 0;
    for (const s of all) {
      if (keys.size && !keys.has(s.key)) continue;
      if (existing.some((e) => e.accountCode === s.accountCode && (e.partnerName ?? "") === (s.partnerName ?? ""))) continue;
      await db.insert(forecastItems).values({
        companyId: cid, category: "expense", description: `${s.partnerName ?? s.accountName}`, accountCode: s.accountCode, partnerName: s.partnerName,
        net: s.monthlyNet, vatRate: s.vatRate, deductible: true, frequency: "monthly", startDate: start, payment: s.payment, source: "suggested",
      });
      n++;
    }
    refresh(cid);
    return ok(cid, "costs", n ? `${n} ismétlődő tétel felvéve.` : "Nincs új javaslat (a meglévők már fel vannak véve).");
  });
}
const nextMonth = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** Javasolt tétel frissítése a legutóbbi tényadatokkal (összeg, ÁFA, fizetési mód). */
export async function refreshSuggestedAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "costs"), async () => {
    const all = await costSuggestions(cid);
    const items = await db.select().from(forecastItems).where(and(eq(forecastItems.companyId, cid), eq(forecastItems.source, "suggested")));
    let n = 0;
    for (const it of items) {
      const s = all.find((x) => x.accountCode === it.accountCode && (x.partnerName ?? "") === (it.partnerName ?? ""));
      if (!s) continue;
      await db.update(forecastItems).set({ net: s.monthlyNet, vatRate: s.vatRate, payment: s.payment }).where(eq(forecastItems.id, it.id));
      n++;
    }
    refresh(cid);
    return ok(cid, "costs", `${n} javasolt tétel frissítve a legutóbbi adatokkal.`);
  });
}

// --- Forgatókönyv beállítások --------------------------------------------------

const pct = (fd: FormData, k: string) => parseNumber(fd.get(k)) / 100;

export async function saveScenarioSettingsAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "settings"), async () => {
    const cur = await getForecastSettings(cid);
    await saveForecastSettings(cid, {
      ...cur,
      pessimistic: { priceAdj: pct(fd, "p_price"), dateShiftDays: Math.round(parseNumber(fd.get("p_days"))), vehicleCostAdj: pct(fd, "p_vcost"), fixedCostAdj: pct(fd, "p_fixed") },
      optimistic: { priceAdj: pct(fd, "o_price"), dateShiftDays: Math.round(parseNumber(fd.get("o_days"))), vehicleCostAdj: pct(fd, "o_vcost"), fixedCostAdj: pct(fd, "o_fixed") },
      horizonMonths: Math.round(parseNumber(fd.get("horizon"))),
      hipaRate: pct(fd, "hipa"),
      taoRate: pct(fd, "tao"),
      calibratedFrom: "kézi beállítás",
    });
    refresh(cid);
    return ok(cid, "settings", "Beállítások mentve.");
  });
}

export async function calibrateAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "settings"), async () => {
    const c = await calibrationFor(cid);
    if (!c.used) throw new Error(`Kevés a lezárt eladás a kalibráláshoz (${c.history.length} db, legalább 8 kell) – maradnak az alapértékek.`);
    await saveForecastSettings(cid, c.settings);
    refresh(cid);
    return ok(cid, "settings", `Kalibrálva ${c.stats!.n} eladás alapján (medián ${c.stats!.medianDays} nap készleten).`);
  });
}

export async function resetScenarioAction(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true });
  await runOrRedirect(back(cid, "settings"), async () => {
    const cur = await getForecastSettings(cid);
    await saveForecastSettings(cid, { ...cur, pessimistic: DEFAULT_FORECAST_SETTINGS.pessimistic, optimistic: DEFAULT_FORECAST_SETTINGS.optimistic, calibratedFrom: null });
    refresh(cid);
    return ok(cid, "settings", "Visszaállítva az alapértékekre.");
  });
}

