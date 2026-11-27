import { redirect, unstable_rethrow } from "next/navigation";
import { isSystemError } from "./error-log-calc";

export function errMsg(e: unknown): string {
  if (e instanceof Error) {
    // Postgres egyedi kulcs megsértése
    const cause = (e as { cause?: { code?: string } }).cause;
    if (cause?.code === "23505" || (e as { code?: string }).code === "23505") return "Ilyen azonosítóval már létezik rekord (duplikált).";
    return e.message;
  }
  return String(e);
}

/** Egyszerű <form action> műveletekhez: hiba esetén visszairányít ?error=… paraméterrel. */
export async function runOrRedirect(backTo: string, fn: () => Promise<void | string>) {
  let target: string | void;
  try {
    target = await fn();
  } catch (e) {
    unstable_rethrow(e);
    // v6.7.0 – a programhibák (nem a felhasználói ellenőrzési üzenetek) a hibanaplóba is bekerülnek
    if (isSystemError(e)) await (await import("./error-log")).recordError(e, { path: backTo, kind: "action" });
    const sep = backTo.includes("?") ? "&" : "?";
    redirect(`${backTo}${sep}error=${encodeURIComponent(errMsg(e))}`);
  }
  if (target) redirect(target);
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const optStr = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? null : v;
};
export const intOrNull = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? null : Number(v);
};
