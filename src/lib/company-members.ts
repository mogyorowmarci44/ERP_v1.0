/** v4.5.0 – Tagok és tisztségviselők: nyilvántartás és az okiratok adatai. */
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

const { companyMembers } = schema;
export type CompanyMember = typeof companyMembers.$inferSelect;
export type CompanyMemberInput = Omit<CompanyMember, "id" | "companyId" | "createdAt">;

/** A tagi kölcsön okiratokhoz szükséges adatok – ennyiből mennyi van kitöltve. */
export function completeness(m: Pick<CompanyMember, "birthPlace" | "birthDate" | "motherName" | "address" | "taxId" | "sharePct" | "startDate" | "partnerId" | "isMember">) {
  const checks: Array<[string, boolean]> = [
    ["születési hely", !!m.birthPlace?.trim()],
    ["születési idő", !!m.birthDate],
    ["anyja neve", !!m.motherName?.trim()],
    ["lakcím", !!m.address?.trim()],
    ["adóazonosító jel", !!m.taxId?.trim()],
    ["kezdő dátum", !!m.startDate],
    ...(m.isMember ? ([["tulajdonrész", m.sharePct != null], ["tagi kölcsön partner", m.partnerId != null]] as Array<[string, boolean]>) : []),
  ];
  return { done: checks.filter((c) => c[1]).length, total: checks.length, missing: checks.filter((c) => !c[1]).map((c) => c[0]) };
}

export const roleLabel = (m: Pick<CompanyMember, "isMember" | "isCeo">) => [m.isMember ? "tag" : null, m.isCeo ? "ügyvezető" : null].filter(Boolean).join(", ") || "–";

export async function listMembers(companyId: number) {
  return db.select().from(companyMembers).where(eq(companyMembers.companyId, companyId)).orderBy(asc(companyMembers.name));
}

export async function saveMember(companyId: number, id: number | null, v: CompanyMemberInput) {
  if (!v.name.trim()) throw new Error("A név kötelező.");
  if (v.sharePct != null && (v.sharePct < 0 || v.sharePct > 100)) throw new Error("A tulajdonrész 0 és 100% között lehet.");
  if (!v.isMember && !v.isCeo) throw new Error("Legalább egy szerep kell: tag vagy ügyvezető.");
  const others = (await listMembers(companyId)).filter((m) => m.id !== id && m.isMember && !m.endDate);
  const total = others.reduce((s, m) => s + (m.sharePct ?? 0), 0) + (v.isMember && !v.endDate ? v.sharePct ?? 0 : 0);
  if (total > 100.0001) throw new Error(`A tulajdonrészek összege ${total.toLocaleString("hu-HU")}% lenne – legfeljebb 100% lehet.`);
  if (id) {
    const [r] = await db.update(companyMembers).set(v).where(and(eq(companyMembers.id, id), eq(companyMembers.companyId, companyId))).returning({ id: companyMembers.id });
    if (!r) throw new Error("Nincs ilyen tag.");
    return r.id;
  }
  const [r] = await db.insert(companyMembers).values({ ...v, companyId }).returning({ id: companyMembers.id });
  return r.id;
}

export async function deleteMember(companyId: number, id: number) {
  await db.delete(companyMembers).where(and(eq(companyMembers.id, id), eq(companyMembers.companyId, companyId)));
}

/** Az aktív ügyvezető (okiratok aláírója). */
export const activeCeo = (list: CompanyMember[]) => list.find((m) => m.isCeo && !m.endDate) ?? null;
