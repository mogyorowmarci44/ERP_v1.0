import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePlatformAdmin } from "@/lib/auth";
import { savePlanAction } from "../actions";
import { stripeConfigured } from "@/lib/billing";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/** v6.8.0 – Csomagok (üzemeltető): név, ár, korlátok, Stripe Price ID. */
export default async function PlansPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const list = await db.select().from(schema.plans).orderBy(asc(schema.plans.sortOrder), asc(schema.plans.priceHuf));
  const Form = ({ p }: { p?: (typeof list)[number] }) => (
    <form action={savePlanAction} className="card form-grid">
      {p && <input type="hidden" name="id" value={p.id} />}
      <label>Kód<input name="code" required defaultValue={p?.code ?? ""} placeholder="pl. alap" /></label>
      <label>Név<input name="name" required defaultValue={p?.name ?? ""} placeholder="pl. Alap" /></label>
      <label>Nettó ár (Ft)<input name="priceHuf" inputMode="numeric" required defaultValue={p?.priceHuf ?? ""} /></label>
      <label>Időszak<select name="interval" defaultValue={p?.interval ?? "month"}><option value="month">havi</option><option value="year">éves</option></select></label>
      <label>Max. cég<input name="maxCompanies" inputMode="numeric" defaultValue={p?.maxCompanies ?? ""} placeholder="üres = korlátlan" /></label>
      <label>Max. felhasználó<input name="maxUsers" inputMode="numeric" defaultValue={p?.maxUsers ?? ""} placeholder="üres = korlátlan" /></label>
      <label title="Stripe Dashboard › Product catalog › a termék ára › Price ID (price_…)">Stripe Price ID<input name="stripePriceId" defaultValue={p?.stripePriceId ?? ""} placeholder="price_…" /></label>
      <label>Sorrend<input name="sortOrder" inputMode="numeric" defaultValue={p?.sortOrder ?? 0} /></label>
      <label style={{ gridColumn: "span 2" }}>Leírás<input name="description" defaultValue={p?.description ?? ""} /></label>
      <label className="check"><input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} /> Választható</label>
      <div style={{ alignSelf: "end" }}><button className="primary">{p ? "Mentés" : "Új csomag"}</button></div>
    </form>
  );
  return (
    <div className="main" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Csomagok</h1>
          <span className="version-tag">v{APP_VERSION}</span>
        </div>
        <div className="row"><Link href="/admin/platform">← Ügyfélfiókok</Link></div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <p className="muted" style={{ marginTop: -4 }}>
        A csomag árát a Stripe-ban is fel kell venni (Product catalog › termék › ismétlődő ár, HUF), és annak <code>price_…</code> azonosítóját ide beírni.
        Az ár itt csak a megjelenítéshez kell; a terhelés a Stripe-beli áron megy. Stripe: {stripeConfigured() ? <span className="badge posted">beállítva</span> : <span className="badge draft">nincs (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)</span>}
      </p>
      {list.map((p) => <Form key={p.id} p={p} />)}
      <h2>Új csomag</h2>
      <Form />
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
