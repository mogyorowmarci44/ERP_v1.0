/**
 * v3.9.6 – Egyezőség-ellenőrzés: a modulok közötti belső konzisztencia egy helyen, bármikor újrafuttatható.
 * Minden ellenőrzés egyetlen SQL-lekérdezés, párhuzamosan futnak. Szintek: error = könyvelési / bevallási hiba,
 * warn = javítandó adat, ok = rendben.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { duplicatePartners } from "./partner-merge";

export type CheckLevel = "ok" | "warn" | "error";
export type CheckItem = { text: string; href?: string };
export type Check = { key: string; title: string; level: CheckLevel; summary: string; items: CheckItem[]; fix?: "recompute_vat" | "merge_partners" | "link_manual" };

type Row = Record<string, unknown>;
const q = async <T extends Row>(s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as T[];
const ft = (n: unknown) => `${Math.round(Number(n)).toLocaleString("hu-HU")} Ft`;

export async function runConsistency(cid: number): Promise<Check[]> {
  const p = `/c/${cid}`;
  const [unbalanced, invGl, hdrLines, openVsGl, vat467, lateVat, cashFrac, stock, reversedInv, dups, closingDrift] = await Promise.all([
    q<{ number: string; id: number; diff: number }>(sql`
      select e.number, e.id, (sum(l.debit) - sum(l.credit))::float8 as diff from journal_entries e join journal_lines l on l.entry_id = e.id
      where e.company_id = ${cid} group by e.id, e.number having abs(sum(l.debit) - sum(l.credit)) >= 0.005 limit 50`),
    q<{ id: number; invoice_number: string; d_ctrl: number; d_vat: number }>(sql`
      -- v7.1.0: halmaz-alapú (naplótételenként egyszer összesít) a számlánkénti al-lekérdezések helyett – nagy cégnél ~25× gyorsabb
      with gl as (
        select jl.entry_id,
          sum(case when a.code like '31%' or a.code ~ '^45[3-5]' then jl.debit - jl.credit else 0 end) party,
          sum(case when a.code = '467' then jl.credit - jl.debit when a.code = '466' then jl.debit - jl.credit else 0 end) gl_vat
        from journal_lines jl join accounts a on a.id = jl.account_id
        where jl.company_id = ${cid} and (a.code like '31%' or a.code ~ '^45[3-5]' or a.code in ('466','467'))
        group by jl.entry_id),
      iv as (
        select il.invoice_id, sum(case
           when (i.direction = 'out' and vc.kind in ('normal', 'margin')) then il.vat_huf
           when i.direction = 'in' and vc.kind in ('reverse_charge', 'eu_acquisition') then il.vat_huf * case when c.entity_type = 'company' then 2 else 1 end
           when i.direction = 'in' and vc.kind = 'normal' and c.entity_type = 'company' then il.vat_huf else 0 end) inv_vat
        from invoice_lines il join invoices i on i.id = il.invoice_id join companies c on c.id = i.company_id join vat_codes vc on vc.id = il.vat_code_id
        where i.company_id = ${cid} and i.status = 'posted' group by il.invoice_id),
      x as (
        select i.id, i.invoice_number, i.gross_huf,
          case when i.direction = 'out' then coalesce(gl.party, 0) else -coalesce(gl.party, 0) end ctrl,
          coalesce(gl.gl_vat, 0) gl_vat, coalesce(iv.inv_vat, 0) inv_vat
        from invoices i left join gl on gl.entry_id = i.journal_entry_id left join iv on iv.invoice_id = i.id
        where i.company_id = ${cid} and i.status = 'posted' and i.journal_entry_id is not null)
      select id, invoice_number, (gross_huf - ctrl)::float8 as d_ctrl, (inv_vat - gl_vat)::float8 as d_vat from x
      where abs(gross_huf - ctrl) >= 0.5 or abs(inv_vat - gl_vat) >= 0.5 limit 50`),
    q<{ id: number; invoice_number: string; diff: number }>(sql`
      select i.id, i.invoice_number, (i.gross_huf - coalesce(sum(il.gross_huf), 0))::float8 as diff from invoices i left join invoice_lines il on il.invoice_id = i.id
      where i.company_id = ${cid} and i.status = 'posted' group by i.id having abs(i.gross_huf - coalesce(sum(il.gross_huf), 0)) >= 0.5 limit 50`),
    q<{ partner: string; partner_id: number; sub: number; gl: number; cand: string | null }>(sql`
      with ap as (select pm.invoice_id, sum(pm.partner_huf) ph from payments pm join journal_entries e on e.id = pm.journal_entry_id
                  where pm.company_id = ${cid} and e.reversed_by_id is null group by 1),
      sub as (select i.partner_id, sum(case when i.direction = 'out' then 1 else -1 end * (i.gross_huf - coalesce(ap.ph, 0))) s from invoices i left join ap on ap.invoice_id = i.id
              where i.company_id = ${cid} and i.status = 'posted' group by 1),
      gl as (select l.partner_id, sum(l.debit - l.credit) g from journal_lines l join accounts a on a.id = l.account_id
             where l.company_id = ${cid} and (a.code like '31%' or a.code ~ '^45[3-5]') group by 1)
      select coalesce(p.name, '(partner nélkül)') as partner, coalesce(sub.partner_id, gl.partner_id) as partner_id, coalesce(sub.s, 0)::float8 as sub, coalesce(gl.g, 0)::float8 as gl,
        (select string_agg(e.number, ', ') from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id
          where e.company_id = ${cid} and coalesce(e.source_type, 'manual') = 'manual' and l.partner_id = coalesce(sub.partner_id, gl.partner_id)
            and (a.code like '31%' or a.code ~ '^45[3-5]') and not exists (select 1 from payments pm where pm.journal_entry_id = e.id)) as cand
      from sub full join gl on gl.partner_id = sub.partner_id left join partners p on p.id = coalesce(sub.partner_id, gl.partner_id)
      where abs(coalesce(sub.s, 0) - coalesce(gl.g, 0)) >= 0.5 order by 1 limit 50`),
    q<{ number: string; id: number; date: string; amt: number }>(sql`
      select e.number, e.id, e.date::text as date, l.debit::float8 as amt from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id
      where e.company_id = ${cid} and a.code = '467' and l.debit > 0 and coalesce(e.source_type, 'manual') = 'manual' and e.reversed_by_id is null
        and exists (select 1 from journal_lines m join accounts ma on ma.id = m.account_id where m.entry_id = e.id and ma.code like '38%' and m.credit > 0)
      order by e.date limit 50`),
    q<{ number: string; id: number; date: string }>(sql`
      select e.number, e.id, e.date::text as date from journal_entries e join vat_closings vc on vc.company_id = e.company_id and e.date between vc.from_date and vc.to_date
      where e.company_id = ${cid} and e.created_at > vc.created_at and coalesce(e.source_type, '') <> 'vat_closing'
        and e.reversal_of_id is distinct from vc.journal_entry_id
        and exists (select 1 from journal_lines l join accounts a on a.id = l.account_id where l.entry_id = e.id and a.code in ('466', '467'))
      order by e.date limit 50`),
    q<{ code: string; name: string; bal: number }>(sql`
      select a.code, a.name, sum(l.debit - l.credit)::float8 as bal from journal_lines l join accounts a on a.id = l.account_id
      where l.company_id = ${cid} and a.code like '381%' and a.currency = 'HUF' group by a.code, a.name
      having sum(l.debit - l.credit) <> round(sum(l.debit - l.credit)) or sum(l.debit - l.credit) < 0`),
    q<{ id: number; title: string; status: string; bal: number }>(sql`
      select v.id, v.make || ' ' || v.model || coalesce(' (' || v.plate || ')', '') as title, v.status::text as status,
        coalesce((select sum(l.debit - l.credit) from journal_lines l join accounts a on a.id = l.account_id where l.vehicle_id = v.id and a.code = '261'), 0)::float8 as bal
      from vehicles v where v.company_id = ${cid}
        and ((v.status = 'sold' and abs(coalesce((select sum(l.debit - l.credit) from journal_lines l join accounts a on a.id = l.account_id where l.vehicle_id = v.id and a.code = '261'), 0)) >= 0.5)
          or (v.status <> 'sold' and exists (select 1 from invoice_lines il join invoices i on i.id = il.invoice_id where il.vehicle_id = v.id and i.direction = 'out' and i.status = 'posted'
                and i.corrects_invoice_id is null)))`),
    q<{ id: number; invoice_number: string }>(sql`
      select i.id, i.invoice_number from invoices i join journal_entries e on e.id = i.journal_entry_id
      where i.company_id = ${cid} and i.status = 'posted' and e.reversed_by_id is not null limit 50`),
    duplicatePartners(cid),
    q<{ to_date: string; payable: number; actual: number }>(sql`
      select vc.to_date::text as to_date, vc.payable::float8 as payable,
        coalesce((select sum(l.credit - l.debit) from journal_lines l join accounts a on a.id = l.account_id where l.entry_id = vc.journal_entry_id and a.code = '468'), 0)::float8 as actual
      from vat_closings vc where vc.company_id = ${cid}
        and abs(vc.payable - coalesce((select sum(l.credit - l.debit) from journal_lines l join accounts a on a.id = l.account_id where l.entry_id = vc.journal_entry_id and a.code = '468'), 0)) >= 0.5`),
  ]);

  const c = (key: string, title: string, bad: boolean, level: CheckLevel, okText: string, badText: string, items: CheckItem[], fix?: Check["fix"]): Check =>
    ({ key, title, level: bad ? level : "ok", summary: bad ? badText : okText, items: bad ? items : [], fix: bad ? fix : undefined });

  return [
    c("balance", "Tételek egyensúlya (T = K)", unbalanced.length > 0, "error", "Minden tétel kiegyensúlyozott.", `${unbalanced.length} kiegyensúlyozatlan tétel.`,
      unbalanced.map((r) => ({ text: `${r.number}: eltérés ${ft(r.diff)}`, href: `${p}/journal/${r.id}/edit` }))),
    c("invoice_gl", "Számla ↔ főkönyv (partner- és ÁFA-sor)", invGl.length > 0, "error", "Minden könyvelt számla egyezik a főkönyvvel.", `${invGl.length} számla tér el a könyvelésétől.`,
      invGl.map((r) => ({ text: `${r.invoice_number}: partner ${ft(r.d_ctrl)}, ÁFA ${ft(r.d_vat)}`, href: `${p}/invoices/${r.id}` }))),
    c("invoice_lines", "Számlafej ↔ számlasorok", hdrLines.length > 0, "warn", "A számlák bruttója egyezik a sorok összegével.", `${hdrLines.length} számlánál eltér.`,
      hdrLines.map((r) => ({ text: `${r.invoice_number}: ${ft(r.diff)}`, href: `${p}/invoices/${r.id}` }))),
    c("open_items", "Nyitott tételek ↔ vevő / szállító főkönyv", openVsGl.length > 0, "error", "A nyitott tételek partnerenként egyeznek a 31x / 45x egyenleggel.",
      `${openVsGl.length} partnernél eltér – jellemzően kézi tétellel rendezett, de a számlához nem párosított kifizetés.`,
      openVsGl.map((r) => ({ text: `${r.partner}: nyitott tételek ${ft(r.sub)}, főkönyv ${ft(r.gl)}${r.cand ? ` · párosítható kézi tétel: ${r.cand}` : ""}`, href: `${p}/reports/open-items` })), "link_manual"),
    c("vat_payment", "NAV ÁFA-befizetés a 468-on", vat467.length > 0, "error", "Az ÁFA-befizetések a 468-ra vannak könyvelve.",
      `${vat467.length} ÁFA-befizetés a 467-re került – torzítja az ÁFA-zárást.`, vat467.map((r) => ({ text: `${r.number} (${r.date.slice(0, 10)}): ${ft(r.amt)}`, href: `${p}/journal/${r.id}/edit` }))),
    c("vat_closing", "ÁFA-zárások naprakészek", lateVat.length > 0 || closingDrift.length > 0, "warn", "Nincs a zárás után a lezárt ÁFA-időszakba könyvelt tétel.",
      `${lateVat.length} tétel került lezárt ÁFA-időszakba a zárás után${closingDrift.length ? `, ${closingDrift.length} zárás összege eltér` : ""} – a zárásokat újra kell számolni (és a bevallást önellenőrizni).`,
      [...lateVat.map((r) => ({ text: `${r.number} (${r.date.slice(0, 10)})`, href: `${p}/journal/${r.id}/edit` })), ...closingDrift.map((r) => ({ text: `Zárás ${r.to_date.slice(0, 10)}: ${ft(r.payable)} ≠ 468 ${ft(r.actual)}` }))], "recompute_vat"),
    c("cash", "Pénztár: egész forint, nem negatív", cashFrac.length > 0, "warn", "A pénztárak egyenlege egész forint és nem negatív.", "Pénztár egyenlege fillért tartalmaz vagy negatív.",
      cashFrac.map((r) => ({ text: `${r.code} ${r.name}: ${Number(r.bal).toLocaleString("hu-HU", { minimumFractionDigits: 2 })} Ft`, href: `${p}/money` }))),
    c("stock", "Gépkocsi készlet ↔ 261", stock.length > 0, "error", "Az eladott autók 261-es egyenlege 0, a státuszok egyeznek a számlákkal.", `${stock.length} autónál eltérés.`,
      stock.map((r) => ({ text: `${r.title}: státusz ${r.status}, 261 = ${ft(r.bal)}`, href: `${p}/vehicles/${r.id}` }))),
    c("reversed", "Könyvelt számla sztornózott tétellel", reversedInv.length > 0, "error", "Nincs ilyen számla.", `${reversedInv.length} számla.`,
      reversedInv.map((r) => ({ text: r.invoice_number, href: `${p}/invoices/${r.id}` }))),
    c("partners", "Duplikált partnerek (azonos adószám)", dups.length > 0, "warn", "Nincs duplikált partner.", `${dups.length} partner szerepel többször.`,
      dups.map((g) => ({ text: `${g.drop.map((d) => d.name).join(", ")} → ${g.keep.name} (${g.tax8})` })), "merge_partners"),
  ];
}

/** A napi összefoglalóhoz: hány hiba / figyelmeztetés van. */
export async function consistencyCounts(cid: number) {
  const r = await runConsistency(cid);
  return { errors: r.filter((x) => x.level === "error").length, warnings: r.filter((x) => x.level === "warn").length };
}
