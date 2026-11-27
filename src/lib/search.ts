/**
 * v7.4.0 – Globális kereső: számla, partner, naplótétel és gépkocsi egy mezőből, az összes cégben, amihez a felhasználó
 * hozzáfér (a bizonylatfeltöltő szerep és az archivált cégek kimaradnak; a felhasználó elől elrejtett gépkocsi-modul is).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { moduleVisible } from "@/lib/modules";
import { fmtDate } from "@/lib/dates";
import { parseQuery } from "@/lib/search-calc";
export { parseQuery };

export type Hit = { kind: "invoice" | "partner" | "entry" | "vehicle"; companyId: number; companyName: string; title: string; detail: string; href: string };
type Row = Record<string, unknown>;
const q = async <T extends Row>(s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as T[];

export const PER_KIND = 20;

export async function globalSearch(userId: number, raw: string): Promise<{ hits: Hit[]; companies: number }> {
  const p = parseQuery(raw);
  if (p.s.length < 2) return { hits: [], companies: 0 };
  const cos = await q<{ id: number; name: string; activity_profile: string | null; settings: unknown; hidden: string[] | null }>(sql`
    select c.id, c.name, c.activity_profile, c.settings, m.hidden_modules as hidden from memberships m join companies c on c.id = m.company_id
    where m.user_id = ${userId} and m.role <> 'uploader' and c.archived_at is null`);
  if (!cos.length) return { hits: [], companies: 0 };
  const ids = cos.map((c) => c.id);
  const idList = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  const name = new Map(cos.map((c) => [c.id, c.name]));
  const vehOk = cos.filter((c) => moduleVisible({ activityProfile: c.activity_profile, settings: c.settings }, c.hidden, "vehicles")).map((c) => c.id);

  const [inv, par, ent, veh] = await Promise.all([
    q<{ id: number; company_id: number; invoice_number: string; direction: string; partner: string; fulfillment_date: string; gross: number; currency: string; status: string }>(sql`
      select i.id, i.company_id, i.invoice_number, i.direction, p.name partner, i.fulfillment_date::text, i.gross_fx::float8 gross, i.currency, i.status
      from invoices i join partners p on p.id = i.partner_id
      where i.company_id in (${idList}) and (i.invoice_number ilike ${p.like} or p.name ilike ${p.like}
        ${p.amount !== null ? sql`or abs(i.gross_fx - ${p.amount}) < 0.5 or abs(i.gross_huf - ${p.amount}) < 0.5` : sql``})
      order by i.fulfillment_date desc limit ${PER_KIND}`),
    q<{ id: number; company_id: number; name: string; tax_number: string | null; email: string | null }>(sql`
      select id, company_id, name, tax_number, email from partners
      where company_id in (${idList}) and (name ilike ${p.like} or email ilike ${p.like}
        ${p.digits.length >= 4 ? sql`or regexp_replace(coalesce(tax_number, ''), '\\D', '', 'g') like ${`%${p.digits}%`}` : sql``})
      order by name limit ${PER_KIND}`),
    q<{ id: number; company_id: number; number: string; date: string; description: string | null }>(sql`
      select id, company_id, number, date::text, description from journal_entries
      where company_id in (${idList}) and (number ilike ${p.like} or description ilike ${p.like})
      order by date desc limit ${PER_KIND}`),
    vehOk.length ? q<{ id: number; company_id: number; make: string; model: string; plate: string | null; vin: string | null; status: string }>(sql`
      select id, company_id, make, model, plate, vin, status from vehicles
      where company_id in (${sql.join(vehOk.map((i) => sql`${i}`), sql`, `)}) and (plate ilike ${p.like} or vin ilike ${p.like} or (make || ' ' || model) ilike ${p.like})
      order by id desc limit ${PER_KIND}`) : Promise.resolve([]),
  ]);
  const money = (v: number, c: string) => `${Math.round(v).toLocaleString("hu-HU")} ${c === "HUF" ? "Ft" : c}`;
  const hits: Hit[] = [
    ...inv.map((r) => ({ kind: "invoice" as const, companyId: r.company_id, companyName: name.get(r.company_id)!, title: `${r.invoice_number} – ${r.partner}`,
      detail: `${r.direction === "out" ? "vevőszámla" : "szállítói számla"} · ${fmtDate(r.fulfillment_date)} · ${money(Number(r.gross), r.currency)}${r.status !== "posted" ? ` · ${r.status === "draft" ? "piszkozat" : "sztornózva"}` : ""}`,
      href: `/c/${r.company_id}/invoices/${r.id}` })),
    ...par.map((r) => ({ kind: "partner" as const, companyId: r.company_id, companyName: name.get(r.company_id)!, title: r.name, detail: [r.tax_number, r.email].filter(Boolean).join(" · ") || "partner",
      href: `/c/${r.company_id}/partners?edit=${r.id}` })),
    ...ent.map((r) => ({ kind: "entry" as const, companyId: r.company_id, companyName: name.get(r.company_id)!, title: r.number, detail: `${fmtDate(r.date)} · ${r.description ?? ""}`,
      href: `/c/${r.company_id}/journal?from=${r.date}&to=${r.date}` })),
    ...veh.map((r) => ({ kind: "vehicle" as const, companyId: r.company_id, companyName: name.get(r.company_id)!, title: `${r.make} ${r.model}${r.plate ? ` (${r.plate})` : ""}`,
      detail: `${r.vin ?? ""} · ${r.status === "sold" ? "eladva" : "készleten"}`, href: `/c/${r.company_id}/vehicles/${r.id}/karton` })),
  ];
  return { hits, companies: cos.length };
}
