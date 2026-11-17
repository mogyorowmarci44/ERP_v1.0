"use client";
import { useRouter } from "next/navigation";

/**
 * Az egész kártya kattintható (a benne lévő linkek, gombok és a grafikon tooltipje megmarad):
 * kattintásra / Enterre a megadott oldalra visz.
 */
export function ClickCard({ href, className, label, children }: { href: string; className?: string; label: string; children: React.ReactNode }) {
  const router = useRouter();
  const go = (e: React.MouseEvent | React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
    if ("button" in e && (e.metaKey || e.ctrlKey || e.button === 1)) return void window.open(href, "_blank");
    router.push(href);
  };
  return (
    <div
      className={`${className ?? ""} click-card`}
      role="link"
      tabIndex={0}
      aria-label={label}
      onClick={go}
      onKeyDown={(e) => { if (e.key === "Enter") go(e); }}
    >
      {children}
    </div>
  );
}
