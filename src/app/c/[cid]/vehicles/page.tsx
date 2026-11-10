import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { vehicleStock } from "@/lib/reports";
import { saveVehicleAction } from "../actions";
import { Flash } from "@/components/Flash";
import { fmtHuf } from "@/lib/money";
import { fmtDate } from "@/lib/dates";

const statusHu = { in_stock: "készleten", reserved: "foglalt", sold: "eladva" } as const;

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
          <Link className="btn" href={`/c/${cid}/vehicles/kartonok`}>Különbözeti ÁFA kartonok (időszak)</Link>
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
        <div style={{ alignSelf: "end" }} className="row">
          <button className="primary">{edit ? "Mentés" : "Új gépkocsi"}</button>
          {edit && <Link href={`/c/${cid}/vehicles`} className="btn">Mégse</Link>}
        </div>
      </form>
      <p className="muted">A bekerülési érték a 261-es számlára, a gépkocsihoz rendelve könyvelt tételekből (beszerzés, fényezés, javítás) adódik. Eladáskor automatikusan kivezetődik (T 814 / K 261).</p>
      <table>
        <thead><tr><th>Gépkocsi</th><th>Rendszám</th><th>VIN</th><th>Adózás</th><th>Beszerzés</th><th>Státusz</th><th className="num">Összes bekerülés</th><th className="num">Könyv szerinti érték</th><th className="num">Nettó árbevétel</th><th className="num">Fedezet</th><th></th></tr></thead>
        <tbody>
          {show.map((v) => (
            <tr key={v.id}>
              <td>{v.make} {v.model} {v.year ?? ""}</td>
              <td className="mono">{v.plate || <span className="muted" title="Nincs rendszám – az alvázszám az azonosító">(alvázszám)</span>}</td>
              <td className="mono">{v.vin}</td>
              <td>{v.vatTreatment === "margin" ? "különbözeti" : "normál"}</td>
              <td>{fmtDate(v.purchaseDate)}</td>
              <td><span className={`badge ${v.status}`}>{statusHu[v.status]}</span></td>
              <td className="num">{fmtHuf(v.totalCost)}</td>
              <td className="num">{fmtHuf(v.bookValue)}</td>
              <td className="num">{v.revenue ? fmtHuf(v.revenue) : ""}</td>
              <td className="num">{v.status === "sold" ? fmtHuf(v.revenue - v.totalCost) : ""}</td>
              <td className="nowrap">
                <Link href={`/c/${cid}/vehicles?edit=${v.id}`}>szerk.</Link>
                {v.vatTreatment === "margin" && <> · <Link href={`/c/${cid}/vehicles/${v.id}/karton`}>karton</Link></>}
              </td>
            </tr>
          ))}
          {show.length === 0 && <tr><td colSpan={11} className="muted">Nincs gépkocsi.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
