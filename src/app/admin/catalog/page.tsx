import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { Flash } from "@/components/Flash";
import { ErpLogo } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";
import { catalogStats, HA_COUNTED_AT } from "@/lib/car-catalog";
import { fmtNum } from "@/lib/money";
import { importCatalogAction } from "./actions";

export const dynamic = "force-dynamic";

/** v4.5.3 – Típuskatalógus (cégfüggetlen): márka › modell › motorváltozat, évjárat-intervallummal és tömeggel. */
export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const st = await catalogStats();
  return (
    <div className="main" style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Típuskatalógus</h1>
          <span className="version-tag">v{APP_VERSION}</span>
        </div>
        <div className="row"><Link href="/admin">← Admin</Link></div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="card">
        <p style={{ marginTop: 0 }}>
          <strong>{fmtNum(st.makes)}</strong> márka · <strong>{fmtNum(st.models)}</strong> modell · <strong>{fmtNum(st.variants)}</strong> motorváltozat
          {st.variants > 0 && <span className="muted"> · tömeg nélkül: {fmtNum(st.no_weight)}</span>}
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          Kör: a hasznaltauto.hu-n 200-nál több hirdetéssel rendelkező márkák ({HA_COUNTED_AT}), minden modell és motorváltozat (forrás: auto-data.net).
          Változatonként: generáció, gyártás kezdete–vége (évjárat-intervallum), üzemanyag és hajtáslánc, hengerűrtartalom, kW / LE, hajtás, váltó, saját tömeg (tartomány) és megengedett össztömeg.
        </p>
        <form action={importCatalogAction} className="row" style={{ gap: 8 }}>
          <input type="file" name="file" accept=".csv,text/csv" required />
          <button className="primary">Betöltés</button>
          <span className="muted" style={{ fontSize: 13 }}>Újratölthető: a meglévő változatok frissülnek.</span>
        </form>
      </div>
    </div>
  );
}
