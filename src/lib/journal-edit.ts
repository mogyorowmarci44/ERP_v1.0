/**
 * Lekönyvelt kézi (vegyes / bank / pénztár) tétel kiegészítő adatainak módosítása.
 * Csak a megnevezés, a sorok szövege, partnere és gépkocsija módosítható – összeg, főkönyvi számla
 * és dátum nem (azt sztornóval kell javítani). Minden változás a journal_line_changes táblába kerül.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

const { journalEntries, journalLines, journalLineChanges, partners, vehicles } = schema;

/** Csak kézi tételnél engedjük: a számlából, rendezésből, tagi kölcsönből származó sorok partnere / gépkocsija a forrásmodul adata. */
export const EDITABLE_SOURCES = ["manual"];
export const canEditMeta = (e: { sourceType: string | null; reversedById: number | null; reversalOfId: number | null }) =>
  EDITABLE_SOURCES.includes(e.sourceType ?? "") && !e.reversedById && !e.reversalOfId;

export type LineMetaInput = { id: number; description: string | null; partnerId: number | null; vehicleId: number | null };

export async function updateEntryMeta(companyId: number, entryId: number, userId: number, input: { description: string; lines: LineMetaInput[] }) {
  const desc = input.description.trim();
  if (!desc) throw new Error("A megnevezés kötelező.");
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId)));
    if (!e) throw new Error("A tétel nem található.");
    if (!canEditMeta(e)) throw new Error("Csak nem sztornózott kézi tétel adatai módosíthatók. Számlából származó tételt a számlánál javíts.");
    const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, entryId));
    const byId = new Map(lines.map((l) => [l.id, l]));
    const pIds = [...new Set(input.lines.map((l) => l.partnerId).filter((x): x is number => !!x))];
    const vIds = [...new Set(input.lines.map((l) => l.vehicleId).filter((x): x is number => !!x))];
    const okP = pIds.length ? await tx.select({ id: partners.id, name: partners.name }).from(partners).where(and(eq(partners.companyId, companyId), inArray(partners.id, pIds))) : [];
    const okV = vIds.length ? await tx.select({ id: vehicles.id, make: vehicles.make, model: vehicles.model, plate: vehicles.plate }).from(vehicles).where(and(eq(vehicles.companyId, companyId), inArray(vehicles.id, vIds))) : [];
    if (okP.length !== pIds.length) throw new Error("Ismeretlen partner.");
    if (okV.length !== vIds.length) throw new Error("Ismeretlen gépkocsi.");
    const allP = await tx.select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.companyId, companyId));
    const allV = await tx.select({ id: vehicles.id, make: vehicles.make, model: vehicles.model, plate: vehicles.plate }).from(vehicles).where(eq(vehicles.companyId, companyId));
    const pName = (id: number | null) => (id ? allP.find((p) => p.id === id)?.name ?? `#${id}` : null);
    const vName = (id: number | null) => {
      const v = id ? allV.find((x) => x.id === id) : null;
      return v ? `${v.make} ${v.model}${v.plate ? ` (${v.plate})` : ""}` : id ? `#${id}` : null;
    };

    const changes: (typeof journalLineChanges.$inferInsert)[] = [];
    if (desc !== e.description) {
      changes.push({ companyId, entryId, lineId: null, field: "entry_description", oldValue: e.description, newValue: desc, userId });
      await tx.update(journalEntries).set({ description: desc }).where(eq(journalEntries.id, entryId));
    }
    for (const x of input.lines) {
      const l = byId.get(x.id);
      if (!l) throw new Error("A sor nem ehhez a tételhez tartozik.");
      const d = x.description?.trim() || null;
      const patch: Partial<typeof journalLines.$inferInsert> = {};
      if (d !== (l.description ?? null)) { patch.description = d; changes.push({ companyId, entryId, lineId: l.id, field: "description", oldValue: l.description, newValue: d, userId }); }
      if (x.partnerId !== l.partnerId) { patch.partnerId = x.partnerId; changes.push({ companyId, entryId, lineId: l.id, field: "partner", oldValue: pName(l.partnerId), newValue: pName(x.partnerId), userId }); }
      if (x.vehicleId !== l.vehicleId) { patch.vehicleId = x.vehicleId; changes.push({ companyId, entryId, lineId: l.id, field: "vehicle", oldValue: vName(l.vehicleId), newValue: vName(x.vehicleId), userId }); }
      if (Object.keys(patch).length) await tx.update(journalLines).set(patch).where(eq(journalLines.id, l.id));
    }
    if (changes.length) await tx.insert(journalLineChanges).values(changes);
    return changes.length;
  });
}
