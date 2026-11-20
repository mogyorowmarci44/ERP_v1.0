import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { vehicleStock } from "@/lib/reports";
import { saveVehicleAction } from "../actions";
import { Flash } from "@/components/Flash";
import { fmtHuf } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";
import { EPR_CATEGORY_LABEL, EPR_DRIVE_LABEL } from "@/lib/epr";

const statusHu = { in_stock: "készleten", reserved: "foglalt", sold: "eladva" } as const;

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export default async function VehiclesPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  await requireCompany(cid);
  const list = await vehicleStock(cid);
  const edit = sp.edit ? list.find((v) => v.id === Number(sp.edit)) : undefined;
  const show = sp.all ? list : list.filter((v) => v.status !== "sold");
  return (
    <>
      <div className="topbar">
        <h1>Gépkocsi készlet</h1>
        <div className="row">
          <Link className="btn" href={`/c/${cid}/arsugo`}>ÁrSugó</Link>
          <Link className="btn" href={`/c/${cid}/vehicles/kartonok`}>Különbözeti ÁFA kartonok (időszak)</Link>
          <Link className="btn" href={`/c/${cid}/vehicles/epr`}>EPR összesítő (negyedév)</Link>
          <Link className="btn" href={`/c/${cid}/vehicles${sp.all ? "" : "?all=1"}`}>{sp.all ? "Csak készleten" : "Eladottakkal együtt"}</Link>
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <form action={saveVehicleAction} className="card form-grid" key={edit?.id ?? "new"}>
        <input type="hidden" name="cid" value={cid} />
        {edit && <input type="hidden" name="id" value={edit.id} />}
        <label>Gyártmány<input name="make" required defaultValue={edit?.make} /></label>
        <label>Típus<input name="model" required defaultValue={edit?.model} /></label>
        <label>Évjárat<input name="year" type="number" defaultValue={edit?.year ?? ""} /></label>
        <label>Rendszám<input name="plate" defaultValue={edit?.plate ?? ""} /></label>
        <label>Alvázszám (VIN)<input name="vin" defaultValue={edit?.vin ?? ""} /></label>
        <label>Adózás
          <select name="vatTreatment" defaultValue={edit?.vatTreatment ?? "margin"}>
            <option value="margin">különbözeti</option><option value="normal">normál ÁFA</option>
          </select>
        </label>
        <label title="Ha üresen hagyod, a gépkocsira könyvelt különbözeti beszerzési számlákból számolódik.">Különbözeti ÁFA alap (beszerzési ár, opcionális)
          <input name="purchasePrice" className="num" defaultValue={edit?.purchasePrice ?? ""} placeholder="számlákból" />
        </label>
        <label>Megjegyzés<input name="note" defaultValue={edit?.note ?? ""} /></label>
        <label title="EPR (80/2023. Korm. r.) – csak M1, N1 és háromkerekű gépjármű tartozik a gépjármű termékáramba.">EPR kategória
          <select name="eprCategory" defaultValue={edit?.eprCategory ?? ""}>
            <option value="">– nincs megadva –</option>
            {Object.entries(EPR_CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>EPR hajtás
          <select name="eprDrive" defaultValue={edit?.eprDrive ?? ""}>
            <option value="">– nincs megadva –</option>
            {Object.entries(EPR_DRIVE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label title="A forgalmi engedély szerinti tömeg kg-ban – a díj alapja.">EPR tömeg (kg)<input name="eprMassKg" type="number" min={0} className="num" defaultValue={edit?.eprMassKg ?? ""} /></label>
        <label title="Üresen: a beszerzési számla eladójának országából (HU = belföldi, egyéb = import).">EPR származás
          <select name="eprOrigin" defaultValue={edit?.eprOrigin ?? ""}>
            <option value="">automatikus (beszerzési számlából)</option>
            <option value="import">külföldről behozott</option>
            <option value="domestic">belföldi beszerzés</option>
          </select>
        </label>
        <div style={{ alignSelf: "end" }} className="row">
          <button className="primary">{edit ? "Mentés" : "Új gépkocsi"}</button>
          {edit && <Link href={`/c/${cid}/vehicles`} className="btn">Mégse</Link>}
        </div>
      </form>
      <p className="muted">A bekerülési érték a 261-es számlára, a gépkocsihoz rendelve könyvelt tételekből (beszerzés, fényezés, javítás) adódik. Eladáskor automatikusan kivezetődik (T 814 / K 261).</p>
      <table>
        <thead><tr><th>Gépkocsi</th><th>Rendszám</th><th>VIN</th><th>Adózás</th><th>Beszerzés</th><th>Eladás</th><th className="num">Napok</th><th>Státusz</th><th className="num">Összes bekerülés</th><th className="num">Könyv szerinti érték</th><th className="num">Nettó árbevétel</th><th className="num">Nettó fedezet</th><th></th></tr></thead>
        <tbody>
          {show.map((v) => (
            <tr key={v.id}>
              <td><Link href={`/c/${cid}/vehicles/${v.id}/merleg`} title="AutóMérleg">{v.make} {v.model} {v.year ?? ""}</Link></td>
              <td className="mono">{v.plate || <span className="muted" title="Nincs rendszám – az alvázszám az azonosító">(alvázszám)</span>}</td>
              <td className="mono">{v.vin}</td>
              <td>{v.vatTreatment === "margin" ? "különbözeti" : "normál"}</td>
              <td>{fmtDate(v.purchaseDate)}</td>
              <td>{v.saleDate ? fmtDate(v.saleDate) : ""}</td>
              <td className="num" title={v.saleDate ? "Készleten töltött napok (vételtől eladásig)" : "Készleten töltött napok (vételtől máig)"}>{v.purchaseDate ? daysBetween(v.purchaseDate, v.saleDate ?? today()) : ""}</td>
              <td><span className={`badge ${v.status}`}>{statusHu[v.status]}</span></td>
              <td className="num">{fmtHuf(v.totalCost)}</td>
              <td className="num">{fmtHuf(v.bookValue)}</td>
              <td className="num">{v.revenue ? fmtHuf(v.revenue) : ""}</td>
              <td className="num">{v.status === "sold" ? fmtHuf(v.revenue - v.totalCost) : ""}</td>
              <td className="nowrap">
                <Link href={`/c/${cid}/vehicles?edit=${v.id}`}>szerk.</Link>
                {" · "}<Link href={`/c/${cid}/vehicles/${v.id}/merleg`}>AutóMérleg</Link>
                {v.vatTreatment === "margin" && <> · <Link href={`/c/${cid}/vehicles/${v.id}/karton`}>karton</Link></>}
                {" · "}<Link href={`/c/${cid}/vehicles/${v.id}/epr`} title={v.eprCategory ? undefined : "EPR adatok hiányoznak"}>EPR{v.eprCategory && v.eprMassKg ? "" : " ⚠"}</Link>
              </td>
            </tr>
          ))}
          {show.length === 0 && <tr><td colSpan={13} className="muted">Nincs gépkocsi.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
