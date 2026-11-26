/**
 * v6.0.0 – Belépésvédelem (tiszta függvények, tesztelhetők).
 * Kulcsonként (fiók: email:…, cím: ip:…) számoljuk a hibás próbálkozásokat egy csúszó ablakban;
 * a korlát elérésekor a kulcs egy ideig zárolt – ilyenkor a jelszót sem nézzük meg.
 */
export type ThrottleState = { failures: number; windowStart: Date; lockedUntil: Date | null };
export type ThrottleLimit = { max: number; windowMin: number; lockMin: number };

/** Fiókonként: 5 hibás jelszó 15 percen belül → 15 perc zárolás. */
export const ACCOUNT_LIMIT: ThrottleLimit = { max: 5, windowMin: 15, lockMin: 15 };
/** IP-címenként: 30 hibás próbálkozás 15 percen belül → 30 perc zárolás (sok fiók végigpróbálása ellen). */
export const IP_LIMIT: ThrottleLimit = { max: 30, windowMin: 15, lockMin: 30 };
/** Elfelejtett jelszó kérések: címenként 10 / óra (levélbombázás ellen). */
export const RESET_LIMIT: ThrottleLimit = { max: 10, windowMin: 60, lockMin: 60 };

/** Zárolt-e most a kulcs; ha igen, hány perc van még hátra. */
export function lockedMinutes(st: ThrottleState | null | undefined, now: Date): number {
  if (!st?.lockedUntil || st.lockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((st.lockedUntil.getTime() - now.getTime()) / 60000));
}

/** Egy újabb hibás próbálkozás utáni állapot. A lejárt ablak újraindul; a korlát elérésekor zárolás, és a számláló nulláról indul. */
export function afterFailure(st: ThrottleState | null | undefined, now: Date, lim: ThrottleLimit): ThrottleState & { locked: boolean } {
  const windowOpen = st && now.getTime() - st.windowStart.getTime() < lim.windowMin * 60000;
  const failures = (windowOpen ? st!.failures : 0) + 1;
  const windowStart = windowOpen ? st!.windowStart : now;
  if (failures >= lim.max) return { failures: 0, windowStart: now, lockedUntil: new Date(now.getTime() + lim.lockMin * 60000), locked: true };
  return { failures, windowStart, lockedUntil: null, locked: false };
}

/** A kliens IP-címe a proxy fejlécéből (Render: X-Forwarded-For első eleme). */
export function ipFromForwarded(xff: string | null | undefined, realIp?: string | null): string {
  const first = (xff ?? "").split(",")[0]?.trim();
  const ip = first || (realIp ?? "").trim();
  return ip.slice(0, 64) || "ismeretlen";
}
