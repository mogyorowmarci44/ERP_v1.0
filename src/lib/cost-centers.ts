/** v7.5.0 – Eredmény költséghelyenként / projektenként (az eredményszámlák naplósoraiból). */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type CostCenterResult = { id: number | null; code: string | null; name: string; revenue: number; cost: number; result: number };

export async function costCenterResults(companyId: number, from: string, to: string): Promise<CostCenterResult[]> {
  const rows = (await db.execute(sql`
    select cc.id, cc.code, coalesce(cc.name, '(költséghely nélkül)') as name,
      coalesce(sum(case when a.code like '9%' then l.credit - l.debit end), 0)::float8 as revenue,
      coalesce(sum(case when a.code like '5%' or a.code like '8%' then l.debit - l.credit end), 0)::float8 as cost
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    left join cost_centers cc on cc.id = l.cost_center_id
    where l.company_id = ${companyId} and e.date between ${from} and ${to} and (a.code like '5%' or a.code like '8%' or a.code like '9%')
    group by cc.id, cc.code, cc.name order by cc.code nulls last`)) as unknown as Array<{ id: number | null; code: string | null; name: string; revenue: number; cost: number }>;
  return rows.map((r) => ({ ...r, revenue: Number(r.revenue), cost: Number(r.cost), result: Math.round((Number(r.revenue) - Number(r.cost)) * 100) / 100 }));
}
