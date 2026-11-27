import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { activePlans, stripeConfigured } from "@/lib/billing";
import { accessOf, STATUS_LABEL } from "@/lib/billing-calc";
import { startCheckoutAction, openPortalAction, saveBillingEmailAction } from "./actions";
import { Flash } from "@/components/Flash";
import { ErpLogo, AppFooter } from "@/components/Brand";
import { APP_VERSION } from "@/lib/version";
import { fmtHuf } from "@/lib/money";

export const dynamic = "force-dynamic";

const dt = (d: Date | null) => (d ? d.toLocaleDateString("hu-HU", { timeZone: "Europe/Budapest" }) : "–");

/** v6.8.0 – Előfizetés (az ügyfélfiók adminjának): állapot, csomagok, fizetés Stripe-on át. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, me.organizationId));
  const plans = await activePlans();
  const [[cos], [us]] = await Promise.all([
    db.select({ n: count() }).from(schema.companies).where(eq(schema.companies.organizationId, org.id)),
    db.select({ n: count() }).from(schema.users).where(eq(schema.users.organizationId, org.id)),
  ]);
  const a = accessOf(org, new Date());
  const cur = plans.find((p) => p.id === org.planId);
  const paying = !!org.stripeSubscriptionId && (org.subStatus === "active" || org.subStatus === "past_due" || org.subStatus === "trialing");
  return (
    <div className="main" style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div className="topbar">
        <div className="row" style={{ gap: 14 }}>
          <ErpLogo size={32} />
          <h1>Előfizetés</h1>
          <span className="version-tag">v{APP_VERSION}</span>
        </div>
        <div className="row"><Link href="/admin">← Admin</Link></div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="card" style={{ borderLeft: `4px solid ${a.writable && !a.warn ? "var(--pos)" : "var(--neg, #b42318)"}` }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>{org.name}</strong> · <span className={`badge ${a.writable ? "posted" : "overdue"}`}>{STATUS_LABEL[org.subStatus]}</span>
            {cur && <> · {cur.name}</>}
          </div>
          {paying && stripeConfigured() && <form action={openPortalAction}><button>Számlázás kezelése (kártya, számlák, lemondás)</button></form>}
        </div>
        <p style={{ margin: "8px 0 0" }}>
          {org.subStatus === "trialing" && org.trialEndsAt && <>Próbaidő vége: <strong>{dt(org.trialEndsAt)}</strong>{a.daysLeft != null && a.daysLeft > 0 ? ` (még ${a.daysLeft} nap)` : ""}. </>}
          {org.subStatus === "active" && <>Következő terhelés: <strong>{dt(org.currentPeriodEnd)}</strong>{org.cancelAtPeriodEnd ? " – lemondva, eddig érvényes" : ""}. </>}
          {org.subStatus === "comped" && "Díjmentes ügyfélfiók. "}
          {a.reason && <strong>{a.reason} </strong>}
          {!a.writable && "Az adatok megmaradtak és letölthetők, de új könyvelés nem rögzíthető."}
        </p>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>Használat: {Number(cos.n)} cég{cur?.maxCompanies ? ` / ${cur.maxCompanies}` : ""} · {Number(us.n)} felhasználó{cur?.maxUsers ? ` / ${cur.maxUsers}` : ""}</p>
      </div>

      {org.subStatus !== "comped" && (
        <>
          <h2>Csomagok</h2>
          {!stripeConfigured() && <div className="flash error">Az online fizetés még nincs bekapcsolva – az előfizetéshez vedd fel a kapcsolatot az üzemeltetővel.</div>}
          <div className="grid cols-3" style={{ gap: 12 }}>
            {plans.map((p) => (
              <div key={p.id} className="card" style={{ borderTop: p.id === org.planId ? "4px solid var(--accent)" : undefined }}>
                <h3 style={{ marginTop: 0 }}>{p.name}</h3>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtHuf(p.priceHuf)} Ft <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>+ ÁFA / {p.interval === "year" ? "év" : "hó"}</span></div>
                <p className="muted" style={{ fontSize: 13 }}>{p.maxCompanies ? `${p.maxCompanies} cég` : "korlátlan cég"} · {p.maxUsers ? `${p.maxUsers} felhasználó` : "korlátlan felhasználó"}</p>
                {p.description && <p style={{ fontSize: 13 }}>{p.description}</p>}
                {p.id === org.planId && paying ? <span className="badge posted">jelenlegi csomag</span> : (
                  <form action={startCheckoutAction}>
                    <input type="hidden" name="planId" value={p.id} />
                    <button className="primary" disabled={!stripeConfigured() || !p.stripePriceId || paying}>{paying ? "Váltás: Számlázás kezelése" : "Előfizetek"}</button>
                  </form>
                )}
              </div>
            ))}
            {plans.length === 0 && <p className="muted">Még nincs elérhető csomag.</p>}
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            A fizetés a Stripe biztonságos oldalán történik (bankkártya); a kártyaadatokat az ERP nem látja. A hátralévő próbaidő megmarad, a terhelés annak végén indul.
            Lemondás bármikor, a kifizetett időszak végéig minden elérhető. Lejárat után az adatok megmaradnak, letölthetők, de csak olvashatók.
          </p>
          <h2>Számlázási e-mail cím</h2>
          <form action={saveBillingEmailAction} className="card row" style={{ gap: 10 }}>
            <label>E-mail (a Stripe ide küldi a nyugtát)<input name="billingEmail" type="email" defaultValue={org.billingEmail ?? ""} /></label>
            <button style={{ alignSelf: "end" }}>Mentés</button>
          </form>
        </>
      )}
      <AppFooter version={APP_VERSION} />
    </div>
  );
}
