/**
 * v3.9.6 – Egyszeri adatjavítások (a teljes körű ERP-teszt megállapításai alapján). A migráció után fut (`npm run db:migrate`).
 * Minden javítás idempotens és általános szabályra épül (nem cégnévre): amit egyszer lefuttatott, azt az
 * app_settings.dataFixes kulcsban jegyzi, és többé nem futtatja. Egy hibás javítás nem állítja meg a többit.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { today } from "../src/lib/dates";
import { manualEntry } from "../src/lib/ledger";
import { recomputeVatClosings, listVatPeriods, closeVatPeriod } from "../src/lib/vat-closing";
import { autoLinkManualSettlements } from "../src/lib/matching";
import { mergeAllDuplicates } from "../src/lib/partner-merge";
import { round2 } from "../src/lib/money";

const KEY = "dataFixes";
type Fix = { id: string; title: string; run: () => Promise<string> };

const companiesOf = async (type?: "company" | "private_taxpayer") =>
  (await db.select({ id: schema.companies.id, name: schema.companies.name, entityType: schema.companies.entityType }).from(schema.companies).orderBy(asc(schema.companies.id)))
    .filter((c) => !type || c.entityType === type);

const FIXES: Fix[] = [
  {
    id: "v3.9.6-vat-payments-468",
    title: "NAV ÁFA-befizetések átkönyvelése 467 → 468, ÁFA-zárások újraszámolása",
    run: async () => {
      const rows = (await db.execute(sql`
        select l.id as line_id, l.entry_id, l.company_id, l.debit::text as debit, e.number from journal_lines l
        join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
        where a.code = '467' and l.debit > 0 and coalesce(e.source_type, 'manual') = 'manual' and e.reversed_by_id is null
          and exists (select 1 from journal_lines m join accounts ma on ma.id = m.account_id where m.entry_id = e.id and ma.code like '38%' and m.credit > 0)`)) as unknown as Array<{ line_id: number; entry_id: number; company_id: number; debit: string; number: string }>;
      const touched = new Set<number>();
      for (const r of rows) {
        const [a468] = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.companyId, r.company_id), eq(schema.accounts.code, "468")));
        if (!a468) continue;
        await db.transaction(async (tx) => {
          await tx.update(schema.journalLines).set({ accountId: a468.id }).where(eq(schema.journalLines.id, r.line_id));
          await tx.insert(schema.journalLineChanges).values({ companyId: r.company_id, entryId: r.entry_id, lineId: r.line_id, field: "account", oldValue: "467", newValue: "468 (v3.9.6: ÁFA-befizetés)" });
        });
        touched.add(r.company_id);
      }
      const out: string[] = [`${rows.length} befizetési sor átkönyvelve`];
      for (const cid of touched) out.push(`cég ${cid}: ${(await recomputeVatClosings(cid)).changed} zárótétel újraszámolva`);
      return out.join("; ");
    },
  },
  {
    id: "v3.9.6-auto-link",
    title: "Kézi tétellel rendezett számlák párosítása (egyértelmű esetek)",
    run: async () => {
      const out: string[] = [];
      for (const c of await companiesOf()) { const r = await autoLinkManualSettlements(c.id); if (r.length) out.push(`${c.name}: ${r.join(", ")}`); }
      return out.join("; ") || "nem volt párosítandó";
    },
  },
  {
    id: "v3.9.6-merge-partners",
    title: "Duplikált partnerek (azonos adószám-törzsszám) összevonása",
    run: async () => {
      const out: string[] = [];
      for (const c of await companiesOf()) { const r = await mergeAllDuplicates(c.id); if (r.length) out.push(`${c.name}: ${r.join(", ")}`); }
      return out.join("; ") || "nem volt duplikátum";
    },
  },
  {
    id: "v3.9.6-cash-cents",
    title: "Forint pénztár fillér-maradványának kerekítése (879 / 979)",
    run: async () => {
      const out: string[] = [];
      const rows = (await db.execute(sql`
        select l.company_id, a.id as account_id, a.code, sum(l.debit - l.credit)::float8 as bal from journal_lines l join accounts a on a.id = l.account_id
        where a.code like '381%' and a.currency = 'HUF' group by 1, 2, 3 having sum(l.debit - l.credit) <> round(sum(l.debit - l.credit))`)) as unknown as Array<{ company_id: number; account_id: number; code: string; bal: number }>;
      for (const r of rows) {
        const frac = round2(Number(r.bal) - Math.round(Number(r.bal)));
        if (Math.abs(frac) < 0.005) continue;
        const acc = await db.select({ id: schema.accounts.id, code: schema.accounts.code }).from(schema.accounts)
          .where(and(eq(schema.accounts.companyId, r.company_id), sql`${schema.accounts.code} in ('879', '979')`));
        const loss = acc.find((a) => a.code === "879")?.id, gain = acc.find((a) => a.code === "979")?.id;
        if (!loss || !gain) continue;
        const amt = Math.abs(frac);
        const lines = frac > 0
          ? [{ accountId: loss, debit: amt, credit: 0 }, { accountId: r.account_id, debit: 0, credit: amt }]
          : [{ accountId: r.account_id, debit: amt, credit: 0 }, { accountId: gain, debit: 0, credit: amt }];
        const e = await manualEntry(r.company_id, { journalCode: "PE", date: today(), description: `Pénztár fillér-maradványának kerekítése (${r.code}) – v3.9.6`, lines });
        out.push(`cég ${r.company_id} ${r.code}: ${frac} Ft (${e.number})`);
      }
      return out.join("; ") || "nem volt fillér";
    },
  },
  {
    id: "v3.9.6-stale-payroll-drafts",
    title: "Elavult bér-piszkozatok törlése (egy későbbi, már könyvelt hónap előtti piszkozat)",
    run: async () => {
      const del = (await db.execute(sql`
        delete from payroll_runs r where r.status = 'draft'
          and exists (select 1 from payroll_runs p where p.company_id = r.company_id and p.status = 'posted' and p.period > r.period)
          and not exists (select 1 from payroll_runs p where p.company_id = r.company_id and p.status = 'posted' and p.period < r.period)
        returning r.company_id, r.period`)) as unknown as Array<{ company_id: number; period: string }>;
      return del.map((d) => `cég ${d.company_id} ${d.period}`).join(", ") || "nem volt";
    },
  },
  {
    id: "v3.9.6-due-dates",
    title: "Kiállítás előtti fizetési határidő javítása (= kiállítás napja)",
    run: async () => {
      const r = (await db.execute(sql`update invoices set due_date = issue_date where due_date < issue_date returning id`)) as unknown as unknown[];
      return `${r.length} számla`;
    },
  },
  {
    id: "v3.9.6-close-vat-periods",
    title: "Lejárt, ÁFA-forgalommal bíró, le nem zárt időszakok ÁFA-zárása (társaságok)",
    run: async () => {
      const out: string[] = [];
      const y = Number(today().slice(0, 4));
      for (const c of await companiesOf("company")) {
        const periods = (await Promise.all([listVatPeriods(c.id, y - 1), listVatPeriods(c.id, y)])).flat();
        for (const p of periods) {
          if (p.closed || !p.ended || (Math.abs(p.m466) < 0.5 && Math.abs(p.m467) < 0.5)) continue;
          try { const r = await closeVatPeriod(c.id, p.from, p.to); out.push(`${c.name} ${p.label}: ${r.entry.number} (${r.net} Ft)`); }
          catch (e) { out.push(`${c.name} ${p.label}: kihagyva – ${(e as Error).message}`); }
        }
      }
      return out.join("; ") || "nem volt lezáratlan időszak";
    },
  },
  {
    id: "v3.9.6-lock-closed-years",
    title: "Időszakzárás azokra az évekre, amelyekhez beszámoló készült",
    run: async () => {
      const r = (await db.execute(sql`
        insert into period_locks (company_id, year, month)
        select ar.company_id, ar.year, m from annual_reports ar cross join generate_series(1, 12) m
        on conflict do nothing returning company_id, year`)) as unknown as Array<{ company_id: number; year: number }>;
      const s = new Set(r.map((x) => `cég ${x.company_id} ${x.year}`));
      return [...s].join(", ") || "nem volt";
    },
  },
];

export async function runDataFixes() {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY));
  const done = new Set<string>(Array.isArray(row?.value) ? (row!.value as string[]) : []);
  for (const f of FIXES) {
    if (done.has(f.id)) continue;
    try {
      const msg = await f.run();
      console.log(`Adatjavítás – ${f.title}: ${msg}`);
      done.add(f.id);
      await db.insert(schema.appSettings).values({ key: KEY, value: [...done] })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: [...done], updatedAt: new Date() } });
    } catch (e) {
      console.error(`Adatjavítás SIKERTELEN – ${f.title}:`, (e as Error).message);
    }
  }
}

if (process.argv[1]?.endsWith("data-fixes.ts")) {
  runDataFixes().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
