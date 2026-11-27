/**
 * v6.8.0 – Előfizetés (tiszta függvények): állapot, írási jog, korlátok.
 *
 * Állapotok: trialing (próbaidő) · active (fizetett) · past_due (sikertelen terhelés – türelmi idő) · canceled (lemondva / lejárt)
 * · comped (díjmentes – pl. az üzemeltető saját fiókja). Lejárt próbaidő, lemondott előfizetés vagy a türelmi időn túli
 * elmaradás esetén az ügyfélfiók csak olvasható: minden adat megmarad és letölthető, de új könyvelés nem rögzíthető.
 */
export type SubStatus = "trialing" | "active" | "past_due" | "canceled" | "comped";
export const GRACE_DAYS = 7;
const DAY = 86_400_000;

export type OrgBilling = {
  subStatus: SubStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  pastDueSince?: Date | null;
};

export type Access = { writable: boolean; reason: string | null; daysLeft: number | null; warn: boolean };

/** Írhat-e az ügyfélfiók, és ha nem (vagy hamarosan nem), miért. */
export function accessOf(o: OrgBilling, now: Date): Access {
  const days = (d: Date | null) => (d ? Math.ceil((d.getTime() - now.getTime()) / DAY) : null);
  switch (o.subStatus) {
    case "comped":
      return { writable: true, reason: null, daysLeft: null, warn: false };
    case "active": {
      // a periódus vége után 2 nappal (webhook-késés) már nem tekintjük aktívnak
      if (o.currentPeriodEnd && o.currentPeriodEnd.getTime() + 2 * DAY < now.getTime())
        return { writable: false, reason: "Az előfizetési időszak lejárt.", daysLeft: 0, warn: true };
      return { writable: true, reason: null, daysLeft: days(o.currentPeriodEnd), warn: false };
    }
    case "trialing": {
      const d = days(o.trialEndsAt);
      if (d !== null && d <= 0) return { writable: false, reason: "A próbaidő lejárt.", daysLeft: 0, warn: true };
      return { writable: true, reason: null, daysLeft: d, warn: d !== null && d <= 5 };
    }
    case "past_due": {
      const since = o.pastDueSince ?? now;
      const left = GRACE_DAYS - Math.floor((now.getTime() - since.getTime()) / DAY);
      if (left <= 0) return { writable: false, reason: "Az előfizetés díja nem került kiegyenlítésre.", daysLeft: 0, warn: true };
      return { writable: true, reason: `Sikertelen terhelés – ${left} napod van rendezni.`, daysLeft: left, warn: true };
    }
    default:
      return { writable: false, reason: "Nincs érvényes előfizetés.", daysLeft: 0, warn: true };
  }
}

/** A Stripe előfizetés-objektumából az ERP állapota. */
export function stateFromStripe(sub: {
  status: string;
  cancel_at_period_end?: boolean | null;
  trial_end?: number | null;
  items?: { data?: { current_period_end?: number | null; price?: { id?: string } | null }[] };
}): { subStatus: SubStatus; currentPeriodEnd: Date | null; trialEndsAt: Date | null; priceId: string | null; cancelAtPeriodEnd: boolean } {
  const item = sub.items?.data?.[0];
  const map: Record<string, SubStatus> = {
    trialing: "trialing", active: "active", past_due: "past_due", unpaid: "past_due",
    canceled: "canceled", incomplete_expired: "canceled", incomplete: "past_due", paused: "canceled",
  };
  return {
    subStatus: map[sub.status] ?? "canceled",
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    priceId: item?.price?.id ?? null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
  };
}

/** Korlát-ellenőrzés (null = korlátlan). */
export function limitError(kind: "companies" | "users", used: number, max: number | null | undefined): string | null {
  if (max == null || used < max) return null;
  return kind === "companies"
    ? `Az előfizetésed legfeljebb ${max} céget enged. Nagyobb csomagra válthatsz az Admin › Előfizetés oldalon.`
    : `Az előfizetésed legfeljebb ${max} felhasználót enged. Nagyobb csomagra válthatsz az Admin › Előfizetés oldalon.`;
}

export const STATUS_LABEL: Record<SubStatus, string> = {
  trialing: "próbaidő", active: "aktív", past_due: "fizetés elmaradt", canceled: "lejárt / lemondva", comped: "díjmentes",
};
