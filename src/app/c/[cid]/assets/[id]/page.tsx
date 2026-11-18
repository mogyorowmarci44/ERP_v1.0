import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";
import { ASSET_ACCOUNTS, accDepAccount, getAsset, periodOf } from "@/lib/assets";
import { updateAssetAction, deleteAssetAction } from "../actions";

export const dynamic = "force-dynamic";

/** Eszközkarton: adatok, ÉCS-terv havonta (könyvelt / esedékes / jövőbeli), szerkesztés. */
export default async function AssetPage({ params, searchParams }: { params: Promise<{ cid: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { cid: c, id: i } = await params;
  const cid = Number(c), id = Number(i);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  if (isPrivate(company)) redirect(`/c/${cid}`);
  const r = await getAsset(cid, id);
  if (!r) notFound();
  const { asset: a, plan, posted } = r;
  const canWrite = role !== "viewer";
  const curP = periodOf(today());
  const byPeriod = new Map(posted.map((p) => [p.d.period, p]));
  const lbl = ASSET_ACCOUNTS.find((x) => x.code === a.accountCode)?.label ?? a.accountCode;
  const sameTax = a.taxRatePct == null;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{a.name}</h1>
          <span className="muted">{a.inventoryNo} · {lbl} · aktiválva {fmtDate(a.activationDate)}{a.status === "disposed" ? ` · kivezetve ${fmtDate(a.disposedOn)}` : ""}</span>
        </div>
        <Link className="btn" href={`/c/${cid}/assets`}>← Tárgyi eszközök</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="grid cols-4 lp-kpi" style={{ marginBottom: 14 }}>
        <div className="card stat"><div className="label">Bekerülési érték</div><div className="value">{fmtHuf(Number(a.cost))}</div></div>
        <div className="card stat"><div className="label">Halmozott ÉCS ({accDepAccount(a.accountCode)})</div><div className="value">{fmtHuf(a.accumulated)}</div></div>
        <div className="card stat"><div className="label">Nettó érték</div><div className="value">{fmtHuf(a.net)}</div></div>
        <div className="card stat"><div className="label">Leírás módja</div><div className="value" style={{ fontSize: 18 }}>{a.method === "lowvalue" ? "egy összegben (kisértékű)" : `lineáris, ${a.usefulLifeMonths / 12} év`}</div></div>
      </div>

      <div className="grid cols-2" style={{ alignItems: "start", gap: 14 }}>
        <div>
          <h2 style={{ marginTop: 0 }}>ÉCS-terv</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Hónap</th><th className="num">Számviteli</th><th className="num">Adótörvényi</th><th className="num">Halmozott</th><th>Könyvelés</th></tr></thead>
              <tbody>
                {plan.map((p) => {
                  const done = byPeriod.get(p.period);
                  return (
                    <tr key={p.period} style={p.period > curP ? { opacity: 0.55 } : undefined}>
                      <td>{p.period}</td>
                      <td className="num">{fmtHuf(done ? Number(done.d.amount) : p.amount)}</td>
                      <td className="num">{fmtHuf(done ? Number(done.d.taxAmount) : p.taxAmount)}</td>
                      <td className="num">{fmtHuf(p.cumAmount)}</td>
                      <td>{done ? (done.number ? <Link className="mono" href={`/c/${cid}/journal/${done.d.journalEntryId}`}>{done.number}</Link> : <span className="muted small">nyitó / korábban</span>) : p.period <= curP ? <span className="badge overdue">esedékes</span> : <span className="muted small">terv</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {Number(a.openingAccumulated) > 0 && <p className="muted small">Nyitó (korábban elszámolt) ÉCS: {fmtHuf(Number(a.openingAccumulated))} Ft – a terv ezt beszámítja.</p>}
        </div>

        <div>
          <h2 style={{ marginTop: 0 }}>Adatok</h2>
          <form action={updateAssetAction} className="card form-grid">
            <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} />
            <label>Megnevezés<input name="name" defaultValue={a.name} required disabled={!canWrite} /></label>
            <label>Leltári szám<input name="inventoryNo" defaultValue={a.inventoryNo ?? ""} disabled={!canWrite} /></label>
            <label>Gyári szám<input name="serialNo" defaultValue={a.serialNo ?? ""} disabled={!canWrite} /></label>
            <label>Használati hely<input name="location" defaultValue={a.location ?? ""} disabled={!canWrite} /></label>
            <label>Hasznos élettartam (év)<input name="lifeYears" defaultValue={String(a.usefulLifeMonths / 12)} inputMode="decimal" disabled={!canWrite || a.method === "lowvalue"} /></label>
            <label>Maradványérték (Ft)<input name="salvage" defaultValue={String(Number(a.salvage))} inputMode="decimal" disabled={!canWrite || a.method === "lowvalue"} /></label>
            <label>Adótörvényi kulcs (%/év)
              <input name="taxRatePct" defaultValue={sameTax ? "" : String(Number(a.taxRatePct))} placeholder="üres = egyezik a számvitelivel" inputMode="decimal" disabled={!canWrite || a.method === "lowvalue"} />
            </label>
            <label>Megjegyzés<input name="note" defaultValue={a.note ?? ""} disabled={!canWrite} /></label>
            {a.method === "lowvalue" && <input type="hidden" name="lifeYears" value={String(a.usefulLifeMonths / 12)} />}
            {canWrite && <div className="row"><button className="primary">Mentés</button></div>}
          </form>
          <p className="muted small">A számviteli és adótörvényi ÉCS alapból egyezik. Eltérő kulcs esetén (pl. számítógép 33%) a különbség a TAO-alapot módosítja; ez az eszköztükörnél és az éves beszámolóban jelenik meg.</p>
          {canWrite && (
            <form action={deleteAssetAction} style={{ marginTop: 10 }}>
              <input type="hidden" name="cid" value={cid} /><input type="hidden" name="id" value={id} />
              <ConfirmButton message="Biztosan törlöd az eszközt a nyilvántartásból? A főkönyvi tételeket ez nem stornózza.">Törlés a nyilvántartásból</ConfirmButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
