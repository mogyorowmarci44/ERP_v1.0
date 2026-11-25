/** v4.5.3 – Típuskatalógus: betöltés (upsert) és lekérdezés. */
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseCatalogRow, parseCsv, type CatalogRow } from "./car-catalog-parse";

const { carMakes, carModels, carVariants } = schema;

/** hasznaltauto.hu személyautó-hirdetések márkánként (2026-11-25), a 200 feletti márkák – a katalógus köre. */
export const HA_MAKES: Record<string, number> = {
  Volkswagen: 11122, Ford: 9722, "Mercedes-Benz": 8869, BMW: 8461, Opel: 8188, Audi: 6877, Toyota: 6126, Skoda: 5892, Kia: 4461, Suzuki: 3992,
  Renault: 3860, Hyundai: 3630, Peugeot: 3320, Volvo: 2912, Mazda: 2835, Nissan: 2749, Citroen: 2321, Fiat: 2182, Honda: 2021, Dacia: 1763,
  Seat: 1761, Mitsubishi: 1282, BYD: 912, Chery: 892, "Alfa Romeo": 876, Tesla: 832, Porsche: 827, "Land Rover": 806, MG: 728, Chevrolet: 719,
  Lexus: 716, Mini: 661, Jeep: 553, Geely: 411, SsangYong: 395, Cupra: 366, Jaguar: 346, Jaecoo: 276, Omoda: 266, KGM: 254, Subaru: 252, Lada: 229, Dodge: 220,
};
export const HA_COUNTED_AT = "2026-11-25";

const haCount = (make: string) => {
  const k = Object.keys(HA_MAKES).find((m) => m.toLowerCase() === make.toLowerCase());
  return k ? HA_MAKES[k] + (k === "Mercedes-Benz" ? 705 : 0) : null; // a Mercedes-AMG hirdetések a Mercedes-Benz alá
};

/** CSV betöltése: márka/modell létrehozás, változatok upsert (source_id szerint). Idempotens. */
export async function importCatalogCsv(text: string) {
  const rows = parseCsv(text);
  const parsed: CatalogRow[] = [];
  let skipped = 0;
  for (const f of rows.slice(1)) {
    const r = parseCatalogRow(f);
    if (r) parsed.push(r); else if (f.some((x) => x.trim())) skipped++;
  }
  if (!parsed.length) throw new Error("A fájlban nincs értelmezhető sor (autodata_tipusok.csv kell).");

  const makeIds = new Map<string, number>();
  for (const name of [...new Set(parsed.map((r) => r.make))]) {
    const [m] = await db.insert(carMakes).values({ name, haCount: haCount(name), haCountedAt: haCount(name) != null ? HA_COUNTED_AT : null })
      .onConflictDoUpdate({ target: carMakes.name, set: { haCount: haCount(name), haCountedAt: haCount(name) != null ? HA_COUNTED_AT : null } })
      .returning({ id: carMakes.id });
    makeIds.set(name, m.id);
  }
  const modelIds = new Map<string, number>();
  const modelKeys = [...new Map(parsed.map((r) => [`${r.make}\u0000${r.model}`, r])).values()];
  for (let i = 0; i < modelKeys.length; i += 500) {
    const chunk = modelKeys.slice(i, i + 500).map((r) => ({ makeId: makeIds.get(r.make)!, name: r.model.slice(0, 120) }));
    const ret = await db.insert(carModels).values(chunk)
      .onConflictDoUpdate({ target: [carModels.makeId, carModels.name], set: { name: sql`excluded.name` } })
      .returning({ id: carModels.id, makeId: carModels.makeId, name: carModels.name });
    for (const m of ret) modelIds.set(`${m.makeId}\u0000${m.name}`, m.id);
  }
  let upserted = 0;
  for (let i = 0; i < parsed.length; i += 1000) {
    const chunk = parsed.slice(i, i + 1000).map((r) => {
      const { make, model, ...v } = r;
      return { ...v, modelId: modelIds.get(`${makeIds.get(make)}\u0000${model.slice(0, 120)}`)!, source: "auto-data", updatedAt: new Date() };
    });
    const set = Object.fromEntries(Object.keys(chunk[0]).filter((k) => k !== "source" && k !== "sourceId").map((k) => [k, sql.raw(`excluded."${k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())}"`)]));
    await db.insert(carVariants).values(chunk).onConflictDoUpdate({ target: [carVariants.source, carVariants.sourceId], set });
    upserted += chunk.length;
  }
  return { makes: makeIds.size, models: modelIds.size, variants: upserted, skipped };
}

export async function catalogStats() {
  const [r] = (await db.execute(sql`
    select (select count(*) from car_makes)::int makes, (select count(*) from car_models)::int models, (select count(*) from car_variants)::int variants,
           (select count(*) from car_variants where kerb_max_kg is null)::int no_weight, (select max(updated_at) from car_variants) updated`)) as unknown as Array<{ makes: number; models: number; variants: number; no_weight: number; updated: string | null }>;
  return r;
}

/** Változatok egy modellre, opcionálisan évjáratra szűrve (year_from ≤ év ≤ coalesce(year_to, idei év)). */
export async function variantsFor(modelId: number, year?: number) {
  const y = year ?? null;
  return db.select().from(carVariants)
    .where(and(eq(carVariants.modelId, modelId), y == null ? undefined : and(lte(carVariants.yearFrom, y), or(isNull(carVariants.yearTo), gte(carVariants.yearTo, y)))))
    .orderBy(asc(carVariants.generation), asc(carVariants.yearFrom), asc(carVariants.powerHp));
}
