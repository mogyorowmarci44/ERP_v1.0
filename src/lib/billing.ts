import "server-only";
import Stripe from "stripe";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { accessOf, limitError, stateFromStripe, type Access } from "@/lib/billing-calc";
import { appBaseUrl } from "@/lib/user-tokens";

/**
 * v6.8.0 – Előfizetés és Stripe.
 *
 * Beállítás (Render): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET; a csomagok (név, ár, korlátok, Stripe Price ID) az
 * *Admin › Csomagok* oldalon. A fizetés Stripe Checkout-tal, a kártya és a lemondás a Stripe ügyfélportálon intézhető.
 * Az állapotot a webhook (/api/stripe/webhook) tartja naprakészen.
 */
export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;
let client: Stripe | null = null;
export function stripe() {
  if (!stripeConfigured()) throw new Error("A Stripe nincs beállítva (STRIPE_SECRET_KEY).");
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY!));
}

export const TRIAL_DAYS_DEFAULT = 14;

/** Új ügyfélfiók előfizetési kezdőállapota: próbaidő. */
export const trialStart = (days = TRIAL_DAYS_DEFAULT) => ({ subStatus: "trialing" as const, trialEndsAt: new Date(Date.now() + days * 86_400_000) });

export async function orgAccess(organizationId: number | null | undefined): Promise<Access> {
  if (!organizationId) return { writable: true, reason: null, daysLeft: null, warn: false };
  const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!o) return { writable: true, reason: null, daysLeft: null, warn: false };
  return accessOf(o, new Date());
}

export async function activePlans() {
  return db.select().from(schema.plans).where(eq(schema.plans.isActive, true)).orderBy(asc(schema.plans.sortOrder), asc(schema.plans.priceHuf));
}

async function orgPlan(organizationId: number) {
  const [r] = await db.select({ plan: schema.plans }).from(schema.organizations).leftJoin(schema.plans, eq(schema.plans.id, schema.organizations.planId)).where(eq(schema.organizations.id, organizationId));
  return r?.plan ?? null;
}

/** Cégszám-korlát (új cég létrehozása előtt). */
export async function assertCompanyLimit(organizationId: number | null | undefined) {
  if (!organizationId) return;
  const plan = await orgPlan(organizationId);
  // v6.12.0 – a bemutató cég nem számít bele
  const [{ n }] = await db.select({ n: count() }).from(schema.companies).where(and(eq(schema.companies.organizationId, organizationId), sql`coalesce((${schema.companies.settings}->>'demo')::boolean, false) = false`));
  const err = limitError("companies", Number(n), plan?.maxCompanies);
  if (err) throw new Error(err);
}

/** Felhasználószám-korlát (meghívás előtt). */
export async function assertUserLimit(organizationId: number | null | undefined) {
  if (!organizationId) return;
  const plan = await orgPlan(organizationId);
  // v6.11.0 – a csak bizonylatfeltöltő felhasználók nem számítanak bele
  const [{ n }] = await db.select({ n: count() }).from(schema.users).where(and(eq(schema.users.organizationId, organizationId),
    sql`not (exists (select 1 from memberships m where m.user_id = ${schema.users.id}) and not exists (select 1 from memberships m where m.user_id = ${schema.users.id} and m.role <> 'uploader'))`));
  const err = limitError("users", Number(n), plan?.maxUsers);
  if (err) throw new Error(err);
}

/** Stripe Checkout a választott csomagra; visszaadja az átirányítási címet. */
export async function checkoutUrl(organizationId: number, planId: number, email: string): Promise<string> {
  const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  const [p] = await db.select().from(schema.plans).where(and(eq(schema.plans.id, planId), eq(schema.plans.isActive, true)));
  if (!o || !p) throw new Error("Ismeretlen csomag.");
  if (!p.stripePriceId) throw new Error("Ehhez a csomaghoz még nincs Stripe-ár beállítva – szólj az üzemeltetőnek.");
  if (o.stripeSubscriptionId && (o.subStatus === "active" || o.subStatus === "past_due"))
    throw new Error("Már van előfizetésed – csomagot váltani, kártyát cserélni a „Számlázás kezelése” gombbal lehet.");
  const s = stripe();
  let customer = o.stripeCustomerId;
  if (!customer) {
    const c = await s.customers.create({ email: o.billingEmail ?? email, name: o.name, metadata: { organizationId: String(o.id) } });
    customer = c.id;
    await db.update(schema.organizations).set({ stripeCustomerId: customer }).where(eq(schema.organizations.id, o.id));
  }
  const base = await appBaseUrl();
  const trialLeft = o.subStatus === "trialing" && o.trialEndsAt ? Math.floor((o.trialEndsAt.getTime() - Date.now()) / 86_400_000) : 0;
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: String(o.id),
    line_items: [{ price: p.stripePriceId, quantity: 1 }],
    // a hátralévő próbaidő megmarad: a terhelés a próbaidő végén indul
    subscription_data: { metadata: { organizationId: String(o.id), planId: String(p.id) }, ...(trialLeft >= 2 ? { trial_period_days: trialLeft } : {}) },
    allow_promotion_codes: true,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    locale: "hu",
    success_url: `${base}/admin/billing?ok=${encodeURIComponent("Köszönjük! Az előfizetés pár másodpercen belül aktiválódik.")}`,
    cancel_url: `${base}/admin/billing`,
  });
  if (!session.url) throw new Error("A Stripe nem adott fizetési oldalt.");
  return session.url;
}

/** Stripe ügyfélportál (kártya, számlák, csomagváltás, lemondás). */
export async function portalUrl(organizationId: number): Promise<string> {
  const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  if (!o?.stripeCustomerId) throw new Error("Még nincs Stripe-ügyféladat – előbb fizess elő egy csomagra.");
  const r = await stripe().billingPortal.sessions.create({ customer: o.stripeCustomerId, return_url: `${await appBaseUrl()}/admin/billing`, locale: "hu" });
  return r.url;
}

/** Egy Stripe-előfizetés állapotának átvezetése az ügyfélfiókra. */
export async function applySubscription(sub: Stripe.Subscription) {
  const orgId = Number(sub.metadata?.organizationId) || null;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const [o] = orgId
    ? await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId))
    : await db.select().from(schema.organizations).where(eq(schema.organizations.stripeCustomerId, customer));
  if (!o) return { ok: false as const, reason: "ismeretlen ügyfélfiók" };
  const st = stateFromStripe(sub as unknown as Parameters<typeof stateFromStripe>[0]);
  const [plan] = st.priceId ? await db.select().from(schema.plans).where(eq(schema.plans.stripePriceId, st.priceId)) : [];
  await db.update(schema.organizations).set({
    subStatus: st.subStatus,
    currentPeriodEnd: st.currentPeriodEnd,
    trialEndsAt: st.trialEndsAt ?? o.trialEndsAt,
    cancelAtPeriodEnd: st.cancelAtPeriodEnd,
    pastDueSince: st.subStatus === "past_due" ? o.pastDueSince ?? new Date() : null,
    stripeCustomerId: customer,
    stripeSubscriptionId: st.subStatus === "canceled" ? null : sub.id,
    ...(plan ? { planId: plan.id } : {}),
  }).where(eq(schema.organizations.id, o.id));
  return { ok: true as const, organizationId: o.id, status: st.subStatus };
}

/** Webhook-esemény feldolgozása (egyszer); a hívó ellenőrizte az aláírást. */
export async function handleStripeEvent(ev: Stripe.Event, retrieve: (id: string) => Promise<Stripe.Subscription> = (id) => stripe().subscriptions.retrieve(id)) {
  const fresh = await db.insert(schema.stripeEvents).values({ id: ev.id, type: ev.type }).onConflictDoNothing().returning({ id: schema.stripeEvents.id });
  if (!fresh.length) return { skipped: true };
  try {
    return await processEvent(ev, retrieve);
  } catch (e) {
    // hiba esetén a Stripe újraküldi – akkor újra fel kell dolgozni
    await db.delete(schema.stripeEvents).where(eq(schema.stripeEvents.id, ev.id));
    throw e;
  }
}

async function processEvent(ev: Stripe.Event, retrieve: (id: string) => Promise<Stripe.Subscription>) {
  switch (ev.type) {
    case "checkout.session.completed": {
      const s = ev.data.object as Stripe.Checkout.Session;
      if (s.mode !== "subscription" || !s.subscription) return { skipped: true };
      const sub = await retrieve(typeof s.subscription === "string" ? s.subscription : s.subscription.id);
      return applySubscription(sub);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return applySubscription(ev.data.object as Stripe.Subscription);
    default:
      return { skipped: true };
  }
}
