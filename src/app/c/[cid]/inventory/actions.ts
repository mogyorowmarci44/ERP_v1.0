"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { runOrRedirect, str } from "@/lib/action-utils";
import { withAudit } from "@/lib/audit";
import { parseNumber } from "@/lib/money";
import { accountIdByCode, manualEntry, reverseEntry } from "@/lib/ledger";
import { companyMoves, postMonthlyCogs } from "@/lib/inventory";
import { valueMoves } from "@/lib/inventory-calc";
import { today } from "@/lib/dates";

const cidOf = (fd: FormData) => Number(fd.get("cid"));
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

async function ownItem(cid: number, id: number) {
  const [it] = await db.select().from(schema.items).where(and(eq(schema.items.id, id), eq(schema.items.companyId, cid)));
  if (!it) throw new Error("A cikk nem található.");
  return it;
}

/** v6.3.0 – Cikk felvétele / módosítása. */
export async function saveItemAction(fd: FormData) {
  return withAudit("saveItemAction", fd, () => saveItemActionImpl(fd));
}
async function saveItemActionImpl(fd: FormData) {
  const cid = cidOf(fd);
  await requireCompany(cid, { write: true, module: "inventory" });
  const id = Number(fd.get("id")) || 0;
  await runOrRedirect(id ? `/c/${cid}/inventory/${id}` : `/c/${cid}/inventory`, async () => {
    const name = str(fd, "name");
    if (!name) throw new Error("A cikk neve kötelező.");
    const stockAccount = str(fd, "stockAccount");
    const cogsAccount = str(fd, "cogsAccount");
    await accountIdByCode(db, cid, stockAccount).catch(() => { throw new Error(`A ${stockAccount} készletszámla nincs a számlatükörben.`); });
    await accountIdByCode(db, cid, cogsAccount).catch(() => { throw new Error(`A ${cogsAccount} ELÁBÉ-számla nincs a számlatükörben.`); });
    const minRaw = str(fd, "minQty");
    const v = {
      name, sku: str(fd, "sku") || null, unit: str(fd, "unit") || "db", stockAccount, cogsAccount,
      minQty: minRaw ? parseNumber(minRaw) : null, note: str(fd, "note") || null, isActive: id ? fd.get("isActive") === "on" : true,
    };
    try {
      if (id) {
        await ownItem(cid, id);
        await db.update(schema.items).set(v).where(eq(schema.items.id, id));
        return `/c/${cid}/inventory/${id}?ok=${encodeURIComponent("Cikk mentve.")}`;
      }
      const [it] = await db.insert(schema.items).values({ companyId: cid, ...v }).returning();
      return `/c/${cid}/inventory/${it.id}?ok=${encodeURIComponent("Cikk felvéve. Nyitó készletet lent rögzíthetsz.")}`;
    } catch (e) {
      if (String(e).includes("items_company_sku_uq") || String((e as { cause?: unknown })?.cause).includes("items_company_sku_uq")) throw new Error("Ez a cikkszám már létezik.");
      throw e;
    }
  });
}

/**
 * v6.3.0 – Kézi készletmozgás: nyitó készlet (könyvelés nélkül – a nyitó főkönyvi egyenleggel egyeztetendő) vagy
 * leltári eltérés (azonnal könyvelődik: hiány T 869 / K készlet, többlet T készlet / K 969).
 */
export async function stockMoveAction(fd: FormData) {
  return withAudit("stockMoveAction", fd, () => stockMoveActionImpl(fd));
}
async function stockMoveActionImpl(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true, module: "inventory" });
  const itemId = Number(fd.get("itemId"));
  await runOrRedirect(`/c/${cid}/inventory/${itemId}`, async () => {
    const it = await ownItem(cid, itemId);
    const kind = str(fd, "kind") === "opening" ? "opening" : "adjust";
    const date = str(fd, "date");
    if (!isDate(date)) throw new Error("Adj meg dátumot.");
    const qty = parseNumber(str(fd, "quantity"));
    if (!qty) throw new Error("A mennyiség nem lehet nulla.");
    const ucRaw = str(fd, "unitCost");
    const unitCost = ucRaw ? parseNumber(ucRaw) : null;
    if (kind === "opening" && (qty < 0 || unitCost == null)) throw new Error("Nyitó készletnél pozitív mennyiség és egységár kell.");
    if (unitCost != null && unitCost < 0) throw new Error("Az egységár nem lehet negatív.");
    const note = str(fd, "note") || null;
    await db.transaction(async (tx) => {
      const [mv] = await tx.insert(schema.stockMoves).values({ companyId: cid, itemId, date, kind, quantity: qty, unitCost, note, createdBy: user.id }).returning();
      if (kind !== "adjust") return;
      // az eltérés értéke a mozgás pillanatában érvényes átlagáron (többletnél a megadott egységáron)
      const moves = await companyMoves(cid, itemId, tx);
      const vm = valueMoves(moves).moves.find((m) => m.key === `m${mv.id}`)!;
      const value = Math.abs(vm.valueDelta);
      if (value < 0.01) return;
      const stock = await accountIdByCode(tx, cid, it.stockAccount);
      const other = await accountIdByCode(tx, cid, qty < 0 ? "869" : "969");
      const desc = `Leltári ${qty < 0 ? "hiány" : "többlet"} – ${it.name} (${Math.abs(qty)} ${it.unit})`;
      const e = await manualEntry(cid, {
        journalCode: "VN", date, description: desc, sourceType: "stock_adjust",
        lines: qty < 0
          ? [{ accountId: other, debit: value, credit: 0, description: desc }, { accountId: stock, debit: 0, credit: value, description: desc }]
          : [{ accountId: stock, debit: value, credit: 0, description: desc }, { accountId: other, debit: 0, credit: value, description: desc }],
      }, user.id, tx);
      await tx.update(schema.stockMoves).set({ journalEntryId: e.id }).where(eq(schema.stockMoves.id, mv.id));
    });
    revalidatePath(`/c/${cid}/inventory`);
    return `/c/${cid}/inventory/${itemId}?ok=${encodeURIComponent(kind === "opening" ? "Nyitó készlet rögzítve." : "Leltári eltérés rögzítve és lekönyvelve.")}`;
  });
}

/** Kézi mozgás törlése; leltári eltérésnél a könyvelési tétel sztornózódik. */
export async function deleteStockMoveAction(fd: FormData) {
  return withAudit("deleteStockMoveAction", fd, () => deleteStockMoveActionImpl(fd));
}
async function deleteStockMoveActionImpl(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true, module: "inventory" });
  const id = Number(fd.get("id"));
  const [mv] = await db.select().from(schema.stockMoves).where(and(eq(schema.stockMoves.id, id), eq(schema.stockMoves.companyId, cid)));
  await runOrRedirect(`/c/${cid}/inventory/${mv?.itemId ?? ""}`, async () => {
    if (!mv) throw new Error("A mozgás nem található.");
    await db.transaction(async (tx) => {
      if (mv.journalEntryId) await reverseEntry(tx, cid, mv.journalEntryId, today(), user.id, "Leltári eltérés törlése");
      await tx.delete(schema.stockMoves).where(eq(schema.stockMoves.id, id));
    });
    return `/c/${cid}/inventory/${mv.itemId}?ok=${encodeURIComponent(mv.journalEntryId ? "Mozgás törölve, a könyvelési tétel sztornózva." : "Mozgás törölve.")}`;
  });
}

/** Egy hónap ELÁBÉ-különbözetének könyvelése. */
export async function postCogsAction(fd: FormData) {
  return withAudit("postCogsAction", fd, () => postCogsActionImpl(fd));
}
async function postCogsActionImpl(fd: FormData) {
  const cid = cidOf(fd);
  const { user } = await requireCompany(cid, { write: true, module: "inventory" });
  const period = str(fd, "period");
  await runOrRedirect(`/c/${cid}/inventory?year=${period.slice(0, 4)}`, async () => {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Ismeretlen időszak.");
    const r = await postMonthlyCogs(cid, period, user.id);
    return `/c/${cid}/inventory?year=${period.slice(0, 4)}&ok=${encodeURIComponent(`${period} ELÁBÉ lekönyvelve: ${r.amount.toLocaleString("hu-HU")} Ft.`)}`;
  });
}
