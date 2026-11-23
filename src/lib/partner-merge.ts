/**
 * v3.9.6 – Duplikált partnerek összevonása: azonos cégen belül azonos adószám-törzsszám (8 jegy) = ugyanaz a jogalany.
 * A megtartott partner a több hivatkozással rendelkező (egyenlőségnél a hosszabb, majd a régebbi) – a többi
 * hivatkozásai (számlák, főkönyvi sorok, munkavállalók) átkerülnek rá, a hiányzó adatai (adószám, cím, e-mail,
 * közösségi adószám) kiegészülnek, majd a duplikátum törlődik.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";

const { partners, invoices, journalLines, employees } = schema;

export type DuplicateGroup = { tax8: string; keep: { id: number; name: string }; drop: Array<{ id: number; name: string }> };

export const tax8Of = (t: string | null | undefined) => {
  const d = (t ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length !== 10 ? d.slice(0, 8) : null;
};

/** A cég duplikált partnercsoportjai (azonos törzsszám), a javasolt megtartandóval. */
export async function duplicatePartners(companyId: number, tx: Tx | typeof db = db): Promise<DuplicateGroup[]> {
  const rows = (await tx.execute(sql`
    select p.id, p.name, p.tax_number,
      (select count(*) from invoices i where i.partner_id = p.id)::int + (select count(*) from journal_lines l where l.partner_id = p.id)::int as uses
    from partners p where p.company_id = ${companyId} and p.tax_number is not null and p.country = 'HU'`)) as unknown as Array<{ id: number; name: string; tax_number: string; uses: number }>;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = tax8Of(r.tax_number);
    if (k) groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: DuplicateGroup[] = [];
  for (const [tax8, g] of groups) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => Number(b.uses) - Number(a.uses) || b.name.length - a.name.length || a.id - b.id);
    out.push({ tax8, keep: { id: sorted[0].id, name: sorted[0].name }, drop: sorted.slice(1).map((x) => ({ id: x.id, name: x.name })) });
  }
  return out.sort((a, b) => a.keep.name.localeCompare(b.keep.name, "hu"));
}

/** Egy partner összevonása a megtartottba (egy tranzakcióban). */
export async function mergePartner(companyId: number, keepId: number, dropId: number, tx: Tx) {
  if (keepId === dropId) return;
  const ps = await tx.select().from(partners).where(and(eq(partners.companyId, companyId), inArray(partners.id, [keepId, dropId])));
  const keep = ps.find((p) => p.id === keepId), drop = ps.find((p) => p.id === dropId);
  if (!keep || !drop) throw new Error("A partner nem található.");
  // azonos számlaszám mindkét partnernél → ütközne az egyediségi indexszel
  const [clash] = (await tx.execute(sql`
    select a.invoice_number from invoices a join invoices b on b.company_id = a.company_id and b.direction = a.direction and b.invoice_number = a.invoice_number
    where a.partner_id = ${keepId} and b.partner_id = ${dropId} limit 1`)) as unknown as Array<{ invoice_number: string }>;
  if (clash) throw new Error(`Nem vonható össze: a(z) ${clash.invoice_number} számlaszám mindkét partnernél szerepel.`);
  await tx.update(invoices).set({ partnerId: keepId }).where(eq(invoices.partnerId, dropId));
  await tx.update(journalLines).set({ partnerId: keepId }).where(eq(journalLines.partnerId, dropId));
  await tx.update(employees).set({ partnerId: keepId }).where(eq(employees.partnerId, dropId));
  await tx.update(partners).set({
    taxNumber: (keep.taxNumber ?? "").replace(/\D/g, "").length >= (drop.taxNumber ?? "").replace(/\D/g, "").length ? keep.taxNumber : drop.taxNumber,
    euVatNumber: keep.euVatNumber ?? drop.euVatNumber, address: keep.address ?? drop.address, email: keep.email ?? drop.email,
    note: [keep.note, drop.note && `(összevonva: ${drop.name}) ${drop.note}`].filter(Boolean).join(" · ") || null,
  }).where(eq(partners.id, keepId));
  await tx.delete(partners).where(eq(partners.id, dropId));
}

/** A cég összes duplikátum-csoportjának összevonása. Visszaadja az összevont párokat. */
export async function mergeAllDuplicates(companyId: number) {
  return db.transaction(async (tx) => {
    const groups = await duplicatePartners(companyId, tx);
    const done: string[] = [];
    for (const g of groups) for (const d of g.drop) { await mergePartner(companyId, g.keep.id, d.id, tx); done.push(`${d.name} → ${g.keep.name}`); }
    return done;
  });
}
