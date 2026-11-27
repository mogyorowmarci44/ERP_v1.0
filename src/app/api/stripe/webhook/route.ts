import { handleStripeEvent, stripe } from "@/lib/billing";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** v6.8.0 – Stripe webhook: az előfizetés állapotának naprakészen tartása (aláírás-ellenőrzéssel). */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return new Response("A Stripe nincs beállítva.", { status: 503 });
  const body = await req.text();
  let ev;
  try {
    ev = stripe().webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("Érvénytelen aláírás.", { status: 400 });
  }
  try {
    const r = await handleStripeEvent(ev);
    if ("organizationId" in r && r.organizationId) await audit({ action: "billing.update", organizationId: r.organizationId, user: null, details: { event: ev.type, status: r.status } });
    return Response.json({ received: true });
  } catch (e) {
    console.error("[stripe] webhook hiba:", e);
    return new Response("Feldolgozási hiba.", { status: 500 });
  }
}
