"use client";

import { useEffect } from "react";
import { LATEST } from "@/lib/changelog";

/** Megjegyzi (sütiben), hogy a legfrissebb újdonságokat már látta – a Cégeim oldalon eltűnik a jelzés. */
export function MarkSeen() {
  useEffect(() => {
    document.cookie = `seen_news=${LATEST}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax`;
  }, []);
  return null;
}
