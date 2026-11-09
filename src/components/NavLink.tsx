"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** Oldalsáv link aktív jelöléssel. `match` = útvonal-előtag, `exact` = csak pontos egyezés. */
export function NavLink({ href, children, exact }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname();
  const sp = useSearchParams();
  const [hPath, hQuery] = href.split("?");
  let active = exact ? path === hPath : path === hPath || path.startsWith(hPath + "/");
  if (active && hQuery) {
    const q = new URLSearchParams(hQuery);
    for (const [k, v] of q) if ((sp.get(k) ?? "") !== v) active = false;
  }
  return (
    <Link href={href} className={`nav${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
