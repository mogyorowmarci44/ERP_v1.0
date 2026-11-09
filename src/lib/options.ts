/** Űrlapokhoz szükséges törzsadat-listák. */
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { marginPurchaseBase } from "./ledger";

export type Opt = { id: number; label: string };
export type AccountOpt = { id: number; code: string; name: string; currency: string };
export type VatOpt = { id: number; code: string; name: string; rate: number; kind: string };
export type VehicleOpt = { id: number; label: string; vatTreatment: string; marginBase: number };
export type PartnerOpt = { id: number; name: string; country: string };

export async function formOptions(cid: number, includeVehicleIds: number[] = []) {
  const [partners, accounts, vatCodes, vehicles] = await Promise.all([
    db.select().from(schema.partners).where(eq(schema.partners.companyId, cid)).orderBy(asc(schema.partners.name)),
    db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.companyId, cid), eq(schema.accounts.isPosting, true), eq(schema.accounts.isActive, true)))
      .orderBy(asc(schema.accounts.code)),
    db.select().from(schema.vatCodes).where(and(eq(schema.vatCodes.companyId, cid), eq(schema.vatCodes.isActive, true))).orderBy(asc(schema.vatCodes.id)),
    db.select().from(schema.vehicles).where(eq(schema.vehicles.companyId, cid)).orderBy(asc(schema.vehicles.make), asc(schema.vehicles.model)),
  ]);
  const vehicleOpts: VehicleOpt[] = [];
  for (const v of vehicles) {
    if (v.status === "sold" && !includeVehicleIds.includes(v.id)) continue;
    vehicleOpts.push({
      id: v.id,
      label: `${v.make} ${v.model}${v.plate ? ` (${v.plate})` : ""}${v.vin ? ` …${v.vin.slice(-6)}` : ""}`,
      vatTreatment: v.vatTreatment,
      marginBase: await marginPurchaseBase(db, cid, v.id),
    });
  }
  return {
    partners: partners.map((p) => ({ id: p.id, name: p.name, country: p.country })) as PartnerOpt[],
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, currency: a.currency })) as AccountOpt[],
    vatCodes: vatCodes.map((v) => ({ id: v.id, code: v.code, name: v.name, rate: Number(v.rate), kind: v.kind })) as VatOpt[],
    vehicles: vehicleOpts,
  };
}

