import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { Flash } from "@/components/Flash";
import { VatTabs } from "@/components/VatTabs";
import { ConfirmButton } from "@/components/ConfirmButton";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";
import { listVatPeriods } from "@/lib/vat-closing";
import { closeVatAction, reopenVatAction } from "../../../actions";

export const dynamic = "force-dynamic";

/** ÁFA-zárás: bevallási időszakonként a 466 / 467 átvezetése a 468-ra. */
export default async function VatClosingPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const canWrite = role !== "viewer";
  const year = Number(sp.year) || Number(today().slice(0, 4));
  const rows = await listVatPeriods(cid, year);
  const firstOpen = rows.find((r) => !r.closed);
  return (
    <>
      <div className="topbar">
        <div>
          <h1>ÁFA-zárás – {year}</h1>
          <span className="muted">{company.name} · bevallási gyakoriság: {{ monthly: "havi", quarterly: "negyedéves", yearly: "éves" }[company.vatPeriod]}</span>
        </div>
        <div className="row">
          <Link className="btn" href={`?year=${year - 1}`}>← {year - 1}</Link>
          <Link className="btn" href={`?year=${year + 1}`}>{year + 1} →</Link>
        </div>
      </div>
      <VatTabs cid={cid} active="closing" />
      <Flash error={sp.error} ok={sp.ok} />
      <p className="muted">
        A zárás a bevallási időszak utolsó napjával átvezeti a 466 (levonható) és 467 (fizetendő) számla időszak végi egyenlegét a 468 ÁFA-elszámolási
        számlára (T 467 / K 466, a különbözet K 468 = fizetendő, T 468 = visszaigényelhető). A NAV-nak utalást ezután T 468 / K 384 könyveld.
        A zárás minden addig át nem vezetett egyenleget visz – a korábbi, le nem zárt időszakokét és a 467-re közvetlenül könyvelt befizetéseket is.
        {isPrivate(company) ? " Alanyi mentes magánszemélynél jellemzően nincs rá szükség." : ""}
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Időszak</th><th className="num">Forgalom: 466 levonható</th><th className="num">Forgalom: 467 fizetendő</th><th className="num">Zárással a 468-ra (halmozott): fizetendő + / visszaigényelhető −</th><th>Állapot</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.to}>
                <td>{r.label}<div className="muted small">{fmtDate(r.from)} – {fmtDate(r.to)}</div></td>
                <td className="num">{fmtHuf(r.m466)}</td>
                <td className="num">{fmtHuf(r.m467)}</td>
                <td className="num"><strong>{fmtHuf(r.closed ? r.closed.payable : r.net)}</strong></td>
                <td>{r.closed ? <span className="badge posted">lezárva · {r.closed.number}</span>
                  : !r.ended ? <span className="badge draft">folyamatban</span>
                  : Math.abs(r.m466) >= 0.5 || Math.abs(r.m467) >= 0.5 ? <span className="badge overdue">zárásra vár</span>
                  : <span className="badge">nincs ÁFA-forgalom</span>}</td>
                <td>
                  {canWrite && !r.closed && r.ended && (Math.abs(r.b466) >= 0.5 || Math.abs(r.b467) >= 0.5) && (
                    <form action={closeVatAction}>
                      <input type="hidden" name="cid" value={cid} /><input type="hidden" name="from" value={r.from} /><input type="hidden" name="to" value={r.to} />
                      <ConfirmButton className="primary small" message={`Lezárjam a(z) ${r.label} ÁFA-időszakot? VN tétel ${fmtDate(r.to)} dátummal: ${r.net >= 0 ? "fizetendő" : "visszaigényelhető"} ${fmtHuf(Math.abs(r.net))} Ft a 468-ra.${firstOpen && firstOpen.to < r.to ? " Figyelem: korábbi időszak is nyitott – annak egyenlege is ide kerül." : ""}`} pendingText="Zárás…">Zárás</ConfirmButton>
                    </form>
                  )}
                  {canWrite && r.closed && (
                    <form action={reopenVatAction}>
                      <input type="hidden" name="cid" value={cid} /><input type="hidden" name="closingId" value={r.closed.id} /><input type="hidden" name="year" value={year} />
                      <ConfirmButton className="small" message={`Visszavonod a(z) ${r.label} ÁFA-zárását? (storno tétel)`} pendingText="…">Visszavonás</ConfirmButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
