import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { onboardingStatus } from "@/lib/onboarding";
import { onboardingImportAction } from "./actions";
import { fyOf } from "@/lib/corp-tax-data";
import { today } from "@/lib/dates";

export const dynamic = "force-dynamic";

const KIND_TITLE: Record<string, string> = { opening: "Nyitómérleg", partners: "Partnerek", accounts: "Számlatükör" };

/**
 * v6.5.0 – Első lépések új cégnél: cégadatok, modulok, számlatükör, partnerek, nyitómérleg (Excelből), bank, felhasználók.
 * Az importok előbb ellenőrizhetők (semmi nem változik), utána tölthetők be.
 */
export default async function StartPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const { company, steps, counts } = await onboardingStatus(cid);
  const b = `/c/${cid}`;
  const w = role !== "viewer";
  const fy = fyOf(today(), company?.fiscalYearStartMonth ?? 1);
  const defaultDate = `${fy.slice(0, 4)}-${String(company?.fiscalYearStartMonth ?? 1).padStart(2, "0")}-01`;
  const Step = ({ done, n, title, children }: { done: boolean; n: number; title: string; children: React.ReactNode }) => (
    <div className="card" style={{ borderLeft: `4px solid ${done ? "var(--pos)" : "var(--line)"}` }}>
      <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
        <span className={`badge ${done ? "posted" : "draft"}`}>{done ? "kész" : `${n}. lépés`}</span>
        <strong>{title}</strong>
      </div>
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  );
  const Report = ({ kind }: { kind: string }) =>
    sp.k === kind && sp.m ? (
      <div className={`flash ${sp.r === "err" ? "error" : "ok"}`} style={{ whiteSpace: "pre-line", marginTop: 8 }}>{sp.m}</div>
    ) : null;
  const ImportForm = ({ kind, extra }: { kind: "opening" | "partners" | "accounts"; extra?: React.ReactNode }) => (
    <form action={onboardingImportAction} className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }} id={kind}>
      <input type="hidden" name="cid" value={cid} />
      <input type="hidden" name="kind" value={kind} />
      <input type="file" name="file" accept=".xlsx,.csv" required />
      {extra}
      <button name="apply" value="0">Ellenőrzés</button>
      <button name="apply" value="1" className="primary">Betöltés</button>
      <a href={`${b}/start/template?kind=${kind}`} className="muted" style={{ fontSize: 13 }}>minta letöltése (.xlsx)</a>
    </form>
  );
  const done = Object.entries(steps).filter(([k, v]) => !["started", "inboxModule"].includes(k) && v).length;
  return (
    <>
      <h1>Első lépések</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        {company?.name} · {done} / 6 lépés kész. Az importok Excel (.xlsx) vagy CSV fájlból mennek; az „Ellenőrzés” semmit nem változtat, csak megmutatja,
        mi történne. {KIND_TITLE[sp.k ?? ""] && sp.r === "done" && <strong>{KIND_TITLE[sp.k!]}: betöltve.</strong>}
      </p>
      <div className="grid" style={{ gap: 12 }}>
        <Step done={steps.details} n={1} title="Cégadatok és modulok">
          Adószám, székhely, üzleti év, tevékenységprofil; a nem használt modulok kikapcsolhatók. <Link href={`${b}/settings`}>Beállítások →</Link>
        </Step>
        <Step done={false} n={2} title="Számlatükör (ha az előző könyvelőnél saját alszámlák voltak)">
          A cég a magyar mintaszámlatükörrel indul. Ha az előző rendszerben más alszámlák is voltak, töltsd be őket – a meglévő kódoknál csak a megnevezés frissül.
          {w && <ImportForm kind="accounts" />}<Report kind="accounts" />
        </Step>
        <Step done={steps.partners} n={3} title={`Partnerek${counts.partners ? ` (${counts.partners})` : ""}`}>
          Vevők és szállítók listája az előző rendszerből; az adószámokat ellenőrzi, a már meglévőket kihagyja.
          {w && <ImportForm kind="partners" />}<Report kind="partners" />
        </Step>
        <Step done={steps.opening} n={4} title="Nyitómérleg">
          Az előző könyvelő főkönyvi kivonatának záró egyenlegei egyetlen nyitó tételként. Vevő- és szállítóegyenleg partnerenként bontható,
          a hiányzó számlák és partnerek létrejönnek. Tartozik és Követel összesen meg kell egyezzen.
          {w && <ImportForm kind="opening" extra={<label className="row" style={{ gap: 6 }}>Nyitás napja<input type="date" name="date" defaultValue={defaultDate} required /></label>} />}
          <Report kind="opening" />
        </Step>
        <Step done={steps.bank} n={5} title="Bankszámla összekötése">
          Napi automatikus tranzakció-letöltés (PSD2), vagy kivonat-feltöltés. {steps.inboxModule ? <Link href={`${b}/inbox/settings`}>Beérkező bizonylatok › Beállítások →</Link> : <span className="muted">Ehhez kapcsold be a Beérkező bizonylatok modult.</span>}
        </Step>
        <Step done={steps.members} n={6} title="Kollégák és könyvelő meghívása">
          Meghívó e-mailben; a jogosultság (tulajdonos / könyvelő / csak olvasás) cégenként állítható. <Link href={`${b}/settings`}>Beállítások › Felhasználók →</Link>
        </Step>
      </div>
    </>
  );
}
