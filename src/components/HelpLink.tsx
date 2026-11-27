"use client";

import { usePathname } from "next/navigation";
import { helpFor } from "@/lib/help";

/** v6.12.0 – az aktuális oldalhoz tartozó súgórész (új lapon nyílik, hogy a munka ne vesszen el). */
export function HelpLink() {
  const p = usePathname() ?? "";
  return <a className="btn" href={`/sugo#${helpFor(p)}`} target="_blank" rel="noreferrer">Súgó</a>;
}
