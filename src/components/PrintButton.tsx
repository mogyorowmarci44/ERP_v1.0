"use client";
import { withProgress } from "@/lib/progress";

/** Nyomtatás: előbb megvárja a képeket (logó, aláírás…) és betűtípusokat – valódi %-kal –, aztán nyit. */
export function PrintButton({ label = "Nyomtatás / PDF" }: { label?: string }) {
  const run = async () => {
    await withProgress({ key: "print", label: "Nyomtatás előkészítése…", expectedMs: 600 }, async (set) => {
      const imgs = Array.from(document.images).filter((i) => !i.closest(".no-print"));
      const waits: Promise<unknown>[] = imgs.map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => undefined)));
      waits.push(document.fonts?.ready ?? Promise.resolve());
      let n = 0;
      const total = waits.length;
      await Promise.all(waits.map((p) => p.then(() => set((++n / total) * 100))));
      // Két képkocka, hogy a 100% látszódjon és a nyomtatási elrendezés kész legyen
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    setTimeout(() => window.print(), 50);
  };
  return <button className="primary no-print" data-progress="off" onClick={run}>{label}</button>;
}
