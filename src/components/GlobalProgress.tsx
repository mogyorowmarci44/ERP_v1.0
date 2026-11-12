"use client";

import { useEffect, useRef, useState } from "react";
import { progress, routeKey, type ProgressTask } from "@/lib/progress";

/**
 * Az egész appra érvényes kör alakú töltésjelző (%).
 *
 * Magától indul minden várakozásnál:
 *  - űrlap beküldés (belépés, mentés, könyvelés, szűrés…) – a szerveroldali művelet / betöltés végéig,
 *  - belső link / menüpont – az új oldal megérkezéséig,
 *  - kódból indított szerverhívás (pl. számla mentése gombbal) – a válaszig,
 *  - Excel / fájl letöltés – valódi bájt-alapú %-kal,
 * és kézzel is indítható (`progress` / `withProgress`, pl. import, nyomtatás előkészítése).
 *
 * Kikapcsolás egy elemre: `data-progress="off"`; saját felirat: `data-progress-label="…"`.
 */

type Ctl = { id: number; startHref: string; seen: boolean; inflight: number; native: boolean; settle?: number };
let ctl: Ctl | null = null;
let origFetch: typeof fetch | null = null;

const SHOW_AFTER_MS = 300;
const HOLD_DONE_MS = 450;

function headerOf(input: RequestInfo | URL, init: RequestInit | undefined, name: string): string | null {
  const h = init?.headers;
  if (h) {
    if (h instanceof Headers) return h.get(name);
    if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === name)?.[1] ?? null;
    for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === name) return String(v);
  }
  if (typeof Request !== "undefined" && input instanceof Request) return input.headers.get(name);
  return null;
}

/** Next.js belső hívások: szerverművelet (Next-Action) vagy oldaladat (RSC), az előtöltést kihagyva. */
function kindOf(input: RequestInfo | URL, init?: RequestInit): "action" | "rsc" | null {
  if (headerOf(input, init, "next-action")) return "action";
  if (headerOf(input, init, "rsc")) {
    if (headerOf(input, init, "next-router-prefetch") || headerOf(input, init, "next-router-segment-prefetch")) return null;
    return "rsc";
  }
  return null;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function liveCtl(): Ctl | null {
  const cur = progress.current();
  if (!cur || cur.doneAt !== null) return null;
  if (ctl && ctl.id === cur.id) return ctl;
  // Kézzel indított (pl. import) feladat: a hálózati forgalom hozzá csatlakozik
  ctl = { id: cur.id, startHref: location.href, seen: false, inflight: 0, native: false };
  return ctl;
}

function finishIfIdle(c: Ctl) {
  const cur = progress.current();
  if (!cur || cur.id !== c.id || cur.manual) return;
  if (c.inflight === 0) progress.done(c.id);
}

function installFetchHook() {
  if (origFetch || typeof window === "undefined") return;
  origFetch = window.fetch.bind(window);
  const base = origFetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const kind = kindOf(input, init);
    if (!kind) return base(input, init);
    let c = liveCtl();
    if (!c) {
      const id = progress.start({
        key: `${kind}:${routeKey(kind === "rsc" ? urlOf(input) : location.href)}`,
        label: kind === "action" ? "Feldolgozás…" : "Betöltés…",
      });
      c = ctl = { id, startHref: location.href, seen: false, inflight: 0, native: false };
    }
    c.seen = true;
    c.inflight++;
    if (c.settle) clearTimeout(c.settle);
    try {
      return await base(input, init);
    } finally {
      c.inflight--;
      if (c.inflight === 0) {
        const cc = c;
        // A válasz feldolgozása / megjelenítése még tart egy pillanatig
        cc.settle = window.setTimeout(() => finishIfIdle(cc), 180);
      }
    }
  };
}

function startIntent(label: string, key: string, ev: Event) {
  const id = progress.start({ key, label });
  const c: Ctl = (ctl = { id, startHref: location.href, seen: false, inflight: 0, native: false });
  // Ha senki nem vette át (nem Next kezeli), akkor ez teljes oldalbetöltés: az oldal elhagyásáig fut.
  setTimeout(() => {
    if (!ev.defaultPrevented) {
      c.native = true;
      return;
    }
    // Kliensoldali kezelés, de nem lett belőle hálózati hívás (pl. előtöltött oldal, helyi ellenőrzés)
    setTimeout(() => {
      if (!c.seen && c.inflight === 0 && progress.current()?.id === id) progress.done(id, { cancel: true });
    }, 1500);
  }, 0);
}

function labelOf(el: Element | null | undefined): string | null {
  if (!el) return null;
  const d = (el as HTMLElement).dataset?.progressLabel;
  if (d) return d;
  const t = (el.textContent ?? (el as HTMLInputElement).value ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 40) return null;
  return t.endsWith("…") ? t : `${t}…`;
}

function filenameFrom(cd: string | null, fallback: string): string {
  if (cd) {
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (star) {
      try {
        return decodeURIComponent(star[1]);
      } catch {
        /* tovább */
      }
    }
    const plain = /filename="?([^";]+)"?/i.exec(cd);
    if (plain) return plain[1];
  }
  return fallback;
}

/** Fájl letöltése valódi %-kal: előbb a szerver elkészíti (becsült), aztán bájtonként jön (valódi). */
async function download(href: string, suggested: string | null) {
  const isXlsx = /\/export(\?|$)/.test(new URL(href, location.href).pathname);
  const id = progress.start({ key: `dl:${routeKey(href)}`, label: isXlsx ? "Excel készítése…" : "Fájl előkészítése…", manual: true, expectedMs: 2500 });
  try {
    const res = await (origFetch ?? fetch)(href, { credentials: "same-origin" });
    if (!res.ok || !res.body) throw new Error(String(res.status));
    const total = Number(res.headers.get("content-length")) || 0;
    const cur = progress.current();
    const from = cur && cur.id === id ? Math.min(90, progress.percent(cur)) : 0;
    progress.set(id, 0, "Letöltés…", from);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (total) progress.set(id, (loaded / total) * 100);
    }
    const blob = new Blob(chunks as BlobPart[], { type: res.headers.get("content-type") ?? "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameFrom(res.headers.get("content-disposition"), suggested || "letoltes");
    a.dataset.progress = "off";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    progress.done(id);
  } catch {
    progress.done(id, { cancel: true });
    // Hiba esetén a böngésző nyissa meg közvetlenül (látszódjon a hibaüzenet)
    location.href = href;
  }
}

function installDomHooks(): () => void {
  const onSubmit = (e: SubmitEvent) => {
    const form = e.target as HTMLFormElement | null;
    if (!form || form.dataset.progress === "off" || (form.target && form.target !== "_self")) return;
    const sub = e.submitter as HTMLElement | null;
    if (sub?.dataset.progress === "off") return;
    const get = (sub?.getAttribute("formmethod") ?? form.method ?? "get").toLowerCase() === "get";
    const label = form.dataset.progressLabel ?? labelOf(sub) ?? (get ? "Betöltés…" : "Feldolgozás…");
    const key = `submit:${routeKey(location.href)}:${(sub?.textContent ?? sub?.getAttribute("name") ?? "").trim().slice(0, 30)}`;
    startIntent(get ? (form.dataset.progressLabel ?? "Betöltés…") : label, key, e);
  };

  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.dataset.progress === "off") return;
    if (a.target && a.target !== "_self") return;
    let url: URL;
    try {
      url = new URL(a.href, location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) return;
    const isDownload = a.hasAttribute("download") || a.dataset.progressDownload !== undefined || /\/export$/.test(url.pathname);
    if (isDownload) {
      e.preventDefault();
      void download(url.href, a.getAttribute("download"));
      return;
    }
    if (url.pathname === location.pathname && url.search === location.search) return; // csak horgony / ugyanaz az oldal
    const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    const label = a.dataset.progressLabel ?? (text && text.length <= 32 ? `${text} – betöltés…` : "Betöltés…");
    startIntent(label, `nav:${routeKey(url.href)}`, e);
  };

  // Vissza a böngésző gyorsítótárából: ne maradjon beragadt jelző
  const onShow = (e: PageTransitionEvent) => {
    if (e.persisted) progress.done(undefined, { cancel: true });
  };

  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("pageshow", onShow);
  return () => {
    document.removeEventListener("submit", onSubmit, true);
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("pageshow", onShow);
  };
}

if (typeof window !== "undefined") installFetchHook();

function accentNow(): string | null {
  const el = document.querySelector(".shell");
  if (!el) return null;
  return getComputedStyle(el).getPropertyValue("--accent").trim() || null;
}

const R = 19;
const C = 2 * Math.PI * R;

export function GlobalProgress() {
  const [view, setView] = useState<{ pct: number; label: string; done: boolean; accent: string | null } | null>(null);
  const shownId = useRef<number | null>(null);

  useEffect(() => {
    installFetchHook();
    const off = installDomHooks();
    let raf = 0;
    let hideTimer = 0;

    const tick = () => {
      raf = 0;
      const t: ProgressTask | null = progress.current();
      const now = performance.now();
      if (!t) return;

      // Kliensoldali navigáció: ha megváltozott a cím és nincs futó kérés, kész
      if (!t.manual && t.doneAt === null && ctl && ctl.id === t.id && ctl.inflight === 0 && !ctl.native && ctl.startHref && location.href !== ctl.startHref) {
        progress.done(t.id);
      }

      const visibleEnough = now - t.startedAt >= SHOW_AFTER_MS;
      const hasWork = t.manual || (ctl && ctl.id === t.id && (ctl.seen || ctl.native)) || now - t.startedAt > 700;

      if (t.doneAt !== null) {
        if (shownId.current === t.id && !t.cancelled) {
          setView((v) => (v ? { ...v, pct: 100, done: true } : v));
          window.clearTimeout(hideTimer);
          hideTimer = window.setTimeout(() => {
            if (progress.current()?.id === t.id) {
              shownId.current = null;
              setView(null);
            }
          }, HOLD_DONE_MS);
        } else {
          shownId.current = null;
          setView(null);
        }
        return;
      }

      if (visibleEnough && hasWork) {
        if (shownId.current !== t.id) {
          shownId.current = t.id;
          window.clearTimeout(hideTimer);
        }
        const accent = accentNow();
        setView({ pct: progress.percent(t, now), label: t.label, done: false, accent });
      }
      raf = requestAnimationFrame(tick);
    };

    const unsub = progress.subscribe(() => {
      if (!raf) raf = requestAnimationFrame(tick);
    });
    return () => {
      off();
      unsub();
      cancelAnimationFrame(raf);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (!view) return null;
  const pct = Math.round(view.pct);
  const style = view.accent ? ({ "--gp-accent": view.accent } as React.CSSProperties) : undefined;
  return (
    <div className={`gp no-print${view.done ? " gp-done" : ""}`} style={style} role="status" aria-live="polite">
      <div className="gp-ring" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={view.label}>
        <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden>
          <circle className="gp-track" cx="24" cy="24" r={R} />
          <circle className="gp-bar" cx="24" cy="24" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - view.pct / 100)} />
        </svg>
        <span className="gp-pct">{pct}%</span>
      </div>
      <span className="gp-label">{view.done ? "Kész" : view.label}</span>
    </div>
  );
}
