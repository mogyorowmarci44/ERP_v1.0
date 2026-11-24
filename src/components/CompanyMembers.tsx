/** v4.5.0 – Beállítások › Tagok és tisztségviselők: táblázat + oldalpanel (jogviszony, személyes adatok, kapcsolatok). */
import Link from "next/link";
import { completeness, roleLabel, type CompanyMember } from "@/lib/company-members";
import { saveCompanyMemberAction, deleteCompanyMemberAction } from "@/app/c/[cid]/actions";
import { fmtDate } from "@/lib/dates";
import { ConfirmButton } from "@/components/ConfirmButton";

const pct = (n: number | null) => (n == null ? "–" : `${n.toLocaleString("hu-HU", { maximumFractionDigits: 4 })}%`);

export function CompanyMembers({ cid, list, selected, partners, canWrite }: {
  cid: number; list: CompanyMember[]; selected: string | null; partners: Array<{ id: number; name: string }>; canWrite: boolean;
}) {
  const active = list.filter((m) => !m.endDate);
  const shareSum = active.filter((m) => m.isMember).reduce((s, m) => s + (m.sharePct ?? 0), 0);
  const cur = selected === "new" ? null : list.find((m) => String(m.id) === selected) ?? null;
  const open = selected === "new" || !!cur;
  const v: Partial<CompanyMember> = cur ?? { isMember: true, isCeo: false };
  return (
    <>
      <h2 id="tagok">Tagok és tisztségviselők</h2>
      <p className="muted">
        A tagi kölcsön okiratai innen töltődnek ki (személyes adatok, aláírók). Tulajdonrészek összesen: <strong>{pct(shareSum)}</strong>
        {active.some((m) => m.isMember) && Math.abs(shareSum - 100) > 0.0001 && <span className="neg"> – nem 100%</span>}
      </p>
      <div className={`cm-layout${open ? " open" : ""}`}>
        <div>
          <table className="cm-table">
            <thead><tr><th>Név</th><th>Jogviszony</th><th className="num">Rész</th><th>Adatok</th></tr></thead>
            <tbody>
              {list.map((m) => {
                const c = completeness(m);
                return (
                  <tr key={m.id} className={cur?.id === m.id ? "on" : undefined}>
                    <td><Link href={`/c/${cid}/settings?member=${m.id}#tagok`}>{m.name}</Link>{m.endDate && <div className="muted small">kilépett {fmtDate(m.endDate)}</div>}</td>
                    <td>{roleLabel(m)}{m.isCeo && m.representation && <div className="muted small">{m.representation} képviselet</div>}</td>
                    <td className="num">{m.isMember ? pct(m.sharePct) : "–"}</td>
                    <td><span className={`badge ${c.done === c.total ? "posted" : "soon"}`} title={c.missing.length ? `Hiányzik: ${c.missing.join(", ")}` : "Minden adat megvan"}>{c.done}/{c.total}</span></td>
                  </tr>
                );
              })}
              {!list.length && <tr><td colSpan={4} className="muted">Még nincs felvéve tag vagy tisztségviselő.</td></tr>}
              {canWrite && <tr><td colSpan={4}><Link href={`/c/${cid}/settings?member=new#tagok`}>+ Tag vagy tisztségviselő hozzáadása</Link></td></tr>}
            </tbody>
          </table>
        </div>

        {open && (
          <form action={saveCompanyMemberAction} className="card cm-panel">
            <input type="hidden" name="cid" value={cid} />
            {cur && <input type="hidden" name="id" value={cur.id} />}
            <div className="cm-panel-head">
              <strong>{cur ? cur.name : "Új tag vagy tisztségviselő"}</strong>
              <Link className="muted" href={`/c/${cid}/settings#tagok`} aria-label="Bezárás">✕</Link>
            </div>
            <label className="cm-wide">Név<input name="name" defaultValue={v.name ?? ""} required /></label>

            <h3>Jogviszony</h3>
            <div className="cm-grid">
              <label className="row"><input type="checkbox" name="isMember" defaultChecked={!!v.isMember} /> tag</label>
              <label className="row"><input type="checkbox" name="isCeo" defaultChecked={!!v.isCeo} /> ügyvezető</label>
              <label>Tulajdonrész (%)<input name="sharePct" inputMode="decimal" defaultValue={v.sharePct ?? ""} /></label>
              <label>Törzsbetét (Ft)<input name="capital" inputMode="numeric" defaultValue={v.capital ?? ""} /></label>
              <label>Kezdete<input type="date" name="startDate" defaultValue={v.startDate ?? ""} /></label>
              <label>Vége<input type="date" name="endDate" defaultValue={v.endDate ?? ""} /></label>
              <label>Képviselet (ügyvezetőnél)
                <select name="representation" defaultValue={v.representation ?? ""}>
                  <option value="">–</option><option value="önálló">önálló</option><option value="együttes">együttes</option>
                </select>
              </label>
            </div>

            <h3>Személyes adatok</h3>
            <div className="cm-grid">
              <label>Születési hely<input name="birthPlace" defaultValue={v.birthPlace ?? ""} /></label>
              <label>Születési idő<input type="date" name="birthDate" defaultValue={v.birthDate ?? ""} /></label>
              <label>Anyja neve<input name="motherName" defaultValue={v.motherName ?? ""} /></label>
              <label>Adóazonosító jel<input name="taxId" inputMode="numeric" maxLength={10} defaultValue={v.taxId ?? ""} /></label>
              <label className="cm-wide">Lakcím<input name="address" defaultValue={v.address ?? ""} /></label>
            </div>

            <h3>Kapcsolatok</h3>
            <div className="cm-grid">
              <label className="cm-wide">Tagi kölcsön partner
                <select name="partnerId" defaultValue={v.partnerId ?? ""}>
                  <option value="">– nincs összekötve (név szerint keresi) –</option>
                  {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="cm-wide">Megjegyzés<input name="note" defaultValue={v.note ?? ""} /></label>
            </div>

            {cur && (() => {
              const c = completeness(cur);
              return c.missing.length ? <p className="muted small">Az okiratokhoz még hiányzik: {c.missing.join(", ")}.</p> : null;
            })()}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button className="primary" disabled={!canWrite}>Mentés</button>
              {cur && canWrite && (
                <ConfirmButton formAction={deleteCompanyMemberAction} message={`Biztosan törlöd: ${cur.name}? A könyvelést nem érinti.`} pendingText="Törlés…">Törlés</ConfirmButton>
              )}
            </div>
          </form>
        )}
      </div>
    </>
  );
}
