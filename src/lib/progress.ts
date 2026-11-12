/**
 * Globális töltésjelző – kliensoldali tár.
 *
 * Egyszerre egy „aktuális” várakozás van (belépés, mentés, betöltés, import, letöltés, nyomtatás…).
 * A százalék vagy valódi (letöltött bájt, betöltött kép, explicit `set`), vagy becsült:
 * az adott művelet korábbi futási idejéből tanult várható időhöz igazítva, 95%-nál megállva,
 * és csak a tényleges befejezéskor ugrik 100%-ra.
 */

export type ProgressTask = {
  id: number;
  key: string;
  label: string;
  startedAt: number;
  /** Becsült teljes időtartam (ms) – a tanult átlagból vagy alapértékből. */
  expectedMs: number;
  /** Valódi százalék (0–100), ha ismert; különben a becslés fut. */
  real: number | null;
  /** Valódi szakasz a becsült után (pl. Excel: előbb készül, aztán töltődik): ettől a %-tól indul. */
  realFrom: number;
  /** Ha igaz, csak explicit `done` zárja (nem a hálózati forgalom figyelése). */
  manual: boolean;
  /** Egységszám (pl. import: dokumentumok száma) – a tanult idő egységenként értendő. */
  units: number;
  doneAt: number | null;
  cancelled: boolean;
};

type Listener = () => void;

const STORE_KEY = "mmerp.progress.ms";
const DEFAULT_MS = 1600;
let seq = 0;
let current: ProgressTask | null = null;
const listeners = new Set<Listener>();

function readLearned(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function learn(t: ProgressTask) {
  const ms = (t.doneAt ?? performance.now()) - t.startedAt;
  if (ms < 50 || ms > 15 * 60_000) return;
  try {
    const all = readLearned();
    const per = ms / Math.max(1, t.units);
    const prev = all[t.key];
    // Mozgóátlag: az új mérés 40%-os súllyal
    all[t.key] = prev ? prev * 0.6 + per * 0.4 : per;
    const keys = Object.keys(all);
    if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete all[k];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* privát mód / tele tár – nem gond */
  }
}

function emit() {
  for (const l of listeners) l();
}

/** Útvonal normalizálása a tanult időkhöz: számok → :id, a lekérdezés kulcsai maradnak, értékei nem. */
export function routeKey(url: string): string {
  try {
    const u = new URL(url, location.href);
    const path = u.pathname.replace(/\/\d+(?=\/|$)/g, "/:id");
    const q = [...new Set(u.searchParams.keys())].sort().join(",");
    return q ? `${path}?${q}` : path;
  } catch {
    return url;
  }
}

export const progress = {
  /** Új várakozás indítása; a korábbit (ha volt) csendben lezárja. */
  start(opts: { key: string; label: string; manual?: boolean; units?: number; expectedMs?: number }): number {
    if (current && current.doneAt === null) {
      current.cancelled = true;
      current.doneAt = performance.now();
    }
    const units = Math.max(1, opts.units ?? 1);
    const learned = typeof localStorage !== "undefined" ? readLearned()[opts.key] : undefined;
    current = {
      id: ++seq,
      key: opts.key,
      label: opts.label,
      startedAt: performance.now(),
      expectedMs: Math.max(300, learned ? learned * units : opts.expectedMs ?? DEFAULT_MS),
      real: null,
      realFrom: 0,
      manual: !!opts.manual,
      units,
      doneAt: null,
      cancelled: false,
    };
    emit();
    return current.id;
  },

  /** Valódi százalék beállítása (0–100). `from`: a valódi szakasz ettől a ponttól indul a körön. */
  set(id: number, pct: number, label?: string, from?: number) {
    if (!current || current.id !== id || current.doneAt !== null) return;
    if (from !== undefined && current.real === null) current.realFrom = Math.min(95, Math.max(0, from));
    current.real = Math.min(100, Math.max(0, pct));
    if (label) current.label = label;
    emit();
  },

  label(id: number, label: string) {
    if (!current || current.id !== id) return;
    current.label = label;
    emit();
  },

  /** Befejezés: 100%-ra ugrik és eltűnik. `cancel`: nem tanul belőle (pl. hiba, megszakítás). */
  done(id?: number, opts?: { cancel?: boolean }) {
    if (!current || current.doneAt !== null) return;
    if (id !== undefined && current.id !== id) return;
    current.doneAt = performance.now();
    current.cancelled = !!opts?.cancel;
    if (!current.cancelled) learn(current);
    emit();
  },

  current(): ProgressTask | null {
    return current;
  },

  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /** Megjelenítendő százalék az adott pillanatban. */
  percent(t: ProgressTask, now = performance.now()): number {
    if (t.doneAt !== null && !t.cancelled) return 100;
    const elapsed = (t.doneAt ?? now) - t.startedAt;
    // Becsült görbe: a várható idő végére ~84%, aszimptotikusan 95% felé
    const est = 95 * (1 - Math.exp((-1.85 * elapsed) / t.expectedMs));
    if (t.real === null) return est;
    // Valódi szakasz: a becsült részt (realFrom-ig) a valódi arány követi
    const base = Math.min(est, t.realFrom);
    return Math.max(base, t.realFrom + ((100 - t.realFrom) * t.real) / 100);
  },
};

/** Kényelmi burok: egy aszinkron munka teljes ideje alatt fut a jelző. */
export async function withProgress<T>(
  opts: { key: string; label: string; units?: number; expectedMs?: number },
  work: (set: (pct: number, label?: string) => void) => Promise<T>,
): Promise<T> {
  const id = progress.start({ ...opts, manual: true });
  try {
    const r = await work((pct, label) => progress.set(id, pct, label));
    progress.done(id);
    return r;
  } catch (e) {
    progress.done(id, { cancel: true });
    throw e;
  }
}
