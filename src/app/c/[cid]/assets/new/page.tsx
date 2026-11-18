import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { isPrivate } from "@/lib/entity";
import { Flash } from "@/components/Flash";
import { today } from "@/lib/dates";
import { fmtHuf } from "@/lib/money";
import { ASSET_ACCOUNTS, LOW_VALUE_LIMIT } from "@/lib/assets";
import { createAssetAction } from "../actions";

export const dynamic = "force-dynamic";

/** Kézi rögzítés – főleg a már korábban (más rendszerben) könyvelt, nyitó ÉCS-sel rendelkező eszközökhöz. */
export default async function NewAssetPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { write: true });
  if (isPrivate(company)) redirect(`/c/${cid}`);
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Új tárgyi eszköz</h1>
          <span className="muted">{company.name} · a szállítói számlán könyvelt eszközt inkább a „Nyilvántartásba vételre vár” listából vedd fel</span>
        </div>
        <Link className="btn" href={`/c/${cid}/assets`}>← Vissza</Link>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <form action={createAssetAction} className="card form-grid" style={{ maxWidth: 720 }}>
        <input type="hidden" name="cid" value={cid} />
        <label>Megnevezés<input name="name" required /></label>
        <label>Eszközszámla
          <select name="accountCode" defaultValue="143">{ASSET_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}</select>
        </label>
        <label>Aktiválás (használatbavétel) napja<input type="date" name="activationDate" defaultValue={today()} required /></label>
        <label>Bekerülési érték (nettó, Ft)<input name="cost" inputMode="decimal" required /></label>
        <label>Hasznos élettartam (év)<input name="lifeYears" inputMode="decimal" placeholder="üres = a számlacsoport alapértéke" /></label>
        <label>Maradványérték (Ft)<input name="salvage" inputMode="decimal" defaultValue="0" /></label>
        <label>Adótörvényi kulcs (%/év)<input name="taxRatePct" inputMode="decimal" placeholder="üres = egyezik a számvitelivel" /></label>
        <label>Nyitó halmozott ÉCS (Ft)<input name="openingAccumulated" inputMode="decimal" defaultValue="0" /></label>
        <label>Leltári szám<input name="inventoryNo" placeholder="üres = automatikus (TE-0001…)" /></label>
        <label>Gyári szám<input name="serialNo" /></label>
        <label>Használati hely<input name="location" /></label>
        <label>Megjegyzés<input name="note" /></label>
        <p className="muted small" style={{ gridColumn: "1 / -1" }}>
          {fmtHuf(LOW_VALUE_LIMIT)} Ft-ig az eszköz kisértékű: rögzítéskor azonnal egy összegben leíródik (T 572 / K x9). A bekerülési értéket a főkönyvben (eszközszámla) ez a rögzítés nem könyveli – azt a szállítói számla vagy egy vegyes tétel teszi.
        </p>
        <div className="row"><button className="primary">Rögzítés</button></div>
      </form>
    </>
  );
}
