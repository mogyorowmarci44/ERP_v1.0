import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { runConsistency, type Check } from "@/lib/consistency";
import { consistencyFixAction } from "./actions";

export const dynamic = "force-dynamic";

const BADGE: Record<Check["level"], { cls: string; label: string }> = {
  ok: { cls: "posted", label: "rendben" },
  warn: { cls: "draft", label: "figyelmeztetés" },
  error: { cls: "overdue", label: "hiba" },
};
const FIX_LABEL: Record<NonNullable<Check["fix"]>, string> = {
  recompute_vat: "ÁFA-zárások újraszámolása",
  merge_partners: "Partnerek összevonása",
  link_manual: "Egyértelmű párosítások elvégzése",
};

/** v3.9.6 – Egyezőség: a modulok közötti belső konzisztencia ellenőrzése egy helyen. */
export default async function ConsistencyPage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const checks = await runConsistency(cid);
  const errors = checks.filter((c) => c.level === "error").length, warns = checks.filter((c) => c.level === "warn").length;
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Egyezőség</h1>
          <span className="muted">{company.name} · {errors ? `${errors} hiba` : "nincs hiba"}{warns ? ` · ${warns} figyelmeztetés` : ""}</span>
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <p className="muted">
        A főkönyv, a számlák, a pénzügyi rendezések, az ÁFA, a készlet és a partnerek egymáshoz képesti egyezése. Minden megnyitáskor frissen fut;
        a hibák a napi összefoglaló teendői közé is bekerülnek.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Ellenőrzés</th><th>Állapot</th><th>Eredmény</th><th /></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.key}>
                <td><strong>{c.title}</strong></td>
                <td><span className={`badge ${BADGE[c.level].cls}`}>{BADGE[c.level].label}</span></td>
                <td>
                  {c.summary}
                  {c.items.length > 0 && (
                    <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                      {c.items.slice(0, 20).map((it, i) => <li key={i}>{it.href ? <Link href={it.href}>{it.text}</Link> : it.text}</li>)}
                      {c.items.length > 20 && <li className="muted">… és még {c.items.length - 20}</li>}
                    </ul>
                  )}
                </td>
                <td>
                  {c.fix && role !== "viewer" && (
                    <form action={consistencyFixAction}>
                      <input type="hidden" name="cid" value={cid} /><input type="hidden" name="fix" value={c.fix} />
                      <button className="btn">{FIX_LABEL[c.fix]}</button>
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
