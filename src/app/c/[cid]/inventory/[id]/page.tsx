import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCompany } from "@/lib/auth";
import { companyMoves } from "@/lib/inventory";
import { valueMoves } from "@/lib/inventory-calc";
import { saveItemAction, stockMoveAction, deleteStockMoveAction } from "../actions";
import { Flash } from "@/components/Flash";
import { ConfirmButton } from "@/components/ConfirmButton";
import { fmtHuf, fmtNum } from "@/lib/money";
import { fmtDate, today } from "@/lib/dates";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { in: "Bevételezés", out: "Kiadás", opening: "Nyitó készlet", adjust: "Leltári eltérés" };

/** v6.3.0 – Cikk lap: adatok, készletkarton (minden mozgás átlagárral), kézi mozgás. */
export default async function ItemPage({ params, searchParams }: { params: Promise<{ cid: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  const p = await params;
  const cid = Number(p.cid);
  const id = Number(p.id);
  const sp = await searchParams;
  const { role } = await requireCompany(cid);
  const [it] = await db.select().from(schema.items).where(and(eq(schema.items.id, id), eq(schema.items.companyId, cid)));
  if (!it) notFound();
  const { moves, balance } = valueMoves(await companyMoves(cid, id));
  const w = role !== "viewer";
  return (
    <>
      <p><Link href={`/c/${cid}/inventory`}>← Készlet</Link></p>
      <h1>{it.name}{it.sku && <span className="muted"> · {it.sku}</span>}</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <div className="card stat"><div className="label">Készlet</div><div className="value">{fmtNum(balance.qty, { maximumFractionDigits: 4 })} {it.unit}</div></div>
        <div className="card stat"><div className="label">Átlagár</div><div className="value">{fmtHuf(balance.avg)} Ft</div></div>
        <div className="card stat"><div className="label">Érték</div><div className="value">{fmtHuf(balance.value)} Ft</div></div>
      </div>

      <h2>Készletkarton</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Dátum</th><th>Mozgás</th><th>Hivatkozás</th><th className="num">Mennyiség</th><th className="num">Egységár</th><th className="num">Érték</th><th className="num">Készlet</th><th className="num">Készletérték</th><th /></tr></thead>
          <tbody>
            {moves.map((m) => {
              const inv = m.key.startsWith("i") && m.ref ? m.ref.split("#") : null;
              return (
                <tr key={m.key}>
                  <td>{fmtDate(m.date)}</td>
                  <td>{KIND[m.kind]}</td>
                  <td>{inv ? <Link href={`/c/${cid}/invoices/${inv[1]}`}>{inv[0]}</Link> : m.ref}</td>
                  <td className="num">{fmtNum(m.qtyDelta, { maximumFractionDigits: 4 })}</td>
                  <td className="num">{fmtHuf(m.unitCost)}</td>
                  <td className="num">{fmtHuf(m.valueDelta)}</td>
                  <td className="num">{fmtNum(m.balanceQty, { maximumFractionDigits: 4 })}</td>
                  <td className="num">{fmtHuf(m.balanceValue)}</td>
                  <td>
                    {w && m.key.startsWith("m") && (
                      <form action={deleteStockMoveAction}>
                        <input type="hidden" name="cid" value={cid} />
                        <input type="hidden" name="id" value={m.key.slice(1)} />
                        <ConfirmButton className="link" message="Törlöd ezt a mozgást? Leltári eltérésnél a könyvelési tétel sztornózódik.">törlés</ConfirmButton>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {moves.length === 0 && <tr><td colSpan={9} className="muted">Még nincs mozgás.</td></tr>}
          </tbody>
        </table>
      </div>

      {w && (
        <>
          <h2>Kézi mozgás</h2>
          <form action={stockMoveAction} className="card form-grid">
            <input type="hidden" name="cid" value={cid} />
            <input type="hidden" name="itemId" value={id} />
            <label>Típus
              <select name="kind" defaultValue={moves.length ? "adjust" : "opening"}>
                <option value="opening">Nyitó készlet (nem könyvel)</option>
                <option value="adjust">Leltári eltérés (könyvel)</option>
              </select>
            </label>
            <label>Dátum<input type="date" name="date" defaultValue={today()} required /></label>
            <label title="Hiánynál negatív (pl. -2), többletnél pozitív">Mennyiség ({it.unit})<input name="quantity" inputMode="decimal" required /></label>
            <label title="Nyitó készletnél kötelező; többletnél üresen az aktuális átlagár">Egységár (Ft)<input name="unitCost" inputMode="decimal" /></label>
            <label>Megjegyzés<input name="note" /></label>
            <div style={{ alignSelf: "end" }}><button className="primary">Rögzítés</button></div>
          </form>
          <p className="muted" style={{ fontSize: 13 }}>
            A nyitó készlet nem könyvel – a készletszámla nyitó egyenlegét a nyitómérlegben rögzítsd. A leltári hiány az átlagáron
            T 869 / K {it.stockAccount}, a többlet T {it.stockAccount} / K 969 tételként azonnal könyvelődik.
          </p>

          <h2>Cikk adatai</h2>
          <form action={saveItemAction} className="card form-grid">
            <input type="hidden" name="cid" value={cid} />
            <input type="hidden" name="id" value={id} />
            <label>Megnevezés<input name="name" required defaultValue={it.name} /></label>
            <label>Cikkszám<input name="sku" defaultValue={it.sku ?? ""} /></label>
            <label>Mennyiségi egység<input name="unit" defaultValue={it.unit} /></label>
            <label>Minimum készlet<input name="minQty" inputMode="decimal" defaultValue={it.minQty ?? ""} /></label>
            <label>Készletszámla<input name="stockAccount" defaultValue={it.stockAccount} required /></label>
            <label>ELÁBÉ-számla<input name="cogsAccount" defaultValue={it.cogsAccount} required /></label>
            <label>Megjegyzés<input name="note" defaultValue={it.note ?? ""} /></label>
            <label className="check"><input type="checkbox" name="isActive" defaultChecked={it.isActive} /> Aktív (választható a számlákon)</label>
            <div style={{ alignSelf: "end" }}><button className="primary">Mentés</button></div>
          </form>
        </>
      )}
    </>
  );
}
