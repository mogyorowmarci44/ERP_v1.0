/** Céges témák – előre elkészített színvilágok (mint a Chrome témák) + egyedi színek. */
import type { CompanyTheme } from "@/db/schema";

export type ThemePreset = CompanyTheme & { name: string; note: string };

export const PRESETS: ThemePreset[] = [
  { preset: "rendszam", name: "Rendszám", note: "EU-kék, a rendszámtábla csíkja", accent: "#1F4FB8", sidebar: "#131C2E", mode: "light" },
  { preset: "versenyzold", name: "Versenyzöld", note: "Klasszikus brit versenyautó", accent: "#1E7A4C", sidebar: "#0F2A1E", mode: "light" },
  { preset: "rosso", name: "Rosso", note: "Olasz piros, szénszürke", accent: "#C8102E", sidebar: "#25191B", mode: "light" },
  { preset: "benzinkek", name: "Benzinkék", note: "Petróleum és türkiz", accent: "#00808A", sidebar: "#0E2A30", mode: "light" },
  { preset: "narancs", name: "Irányjelző", note: "Borostyán narancs", accent: "#D9690B", sidebar: "#2A1F16", mode: "light" },
  { preset: "levendula", name: "Levendula", note: "Lila, nyugodt", accent: "#6A4BC4", sidebar: "#211A38", mode: "light" },
  { preset: "pezsgo", name: "Pezsgő metál", note: "Meleg bronz", accent: "#9C6B2E", sidebar: "#3A3027", mode: "light" },
  { preset: "cadillac", name: "Pink Cadillac", note: "Ötvenes évek króm és pink", accent: "#C2185B", sidebar: "#2B1222", mode: "light" },
  { preset: "jeg", name: "Jégkristály", note: "Világos oldalsáv, hideg kék", accent: "#2160D8", sidebar: "#E6ECF5", mode: "light" },
  { preset: "garazs", name: "Éjszakai garázs", note: "Sötét mód, kék fény", accent: "#5B93FF", sidebar: "#0B111B", mode: "dark" },
  { preset: "muhely", name: "Műhelylámpa", note: "Sötét mód, sárga fény", accent: "#E8B70E", sidebar: "#14120C", mode: "dark" },
  { preset: "aszfalt", name: "Aszfalt", note: "Sötét mód, mentazöld", accent: "#2FB38A", sidebar: "#0F1716", mode: "dark" },
];

export const DEFAULT_THEME: CompanyTheme = { preset: "rendszam", accent: "#1F4FB8", sidebar: "#131C2E", mode: "light" };

export const isHex = (s: unknown): s is string => typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);

function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const inkOn = (hex: string) => (luminance(hex) > 0.4 ? "#141A22" : "#FFFFFF");

export function normalizeTheme(t: Partial<CompanyTheme> | null | undefined): CompanyTheme {
  if (!t) return DEFAULT_THEME;
  return {
    preset: t.preset ?? "custom",
    accent: isHex(t.accent) ? t.accent : DEFAULT_THEME.accent,
    sidebar: isHex(t.sidebar) ? t.sidebar : DEFAULT_THEME.sidebar,
    mode: t.mode === "dark" ? "dark" : "light",
  };
}

/** CSS változók a témához – a céges felület gyökérelemére kerül. */
export function themeVars(t: CompanyTheme): Record<string, string> {
  const dark = t.mode === "dark";
  const sideLight = luminance(t.sidebar) > 0.4;
  return {
    "--bg": dark ? "#0D131B" : "#EEF1F5",
    "--surface": dark ? "#151D28" : "#FFFFFF",
    "--surface-2": dark ? "#1A2431" : "#F6F8FA",
    "--ink": dark ? "#E4E9F0" : "#17202B",
    "--muted": dark ? "#8F9DAF" : "#5B6878",
    "--line": dark ? "#253142" : "#DEE3EA",
    "--accent": t.accent,
    "--accent-ink": inkOn(t.accent),
    "--side": t.sidebar,
    "--side-ink": sideLight ? "#1B2533" : "#DCE3EC",
    "--side-muted": sideLight ? "#5F6E80" : "#8592A3",
    "--side-hover": sideLight ? "rgba(0,0,0,.06)" : "rgba(255,255,255,.07)",
    "--side-active": sideLight ? "rgba(0,0,0,.09)" : "rgba(255,255,255,.12)",
    colorScheme: dark ? "dark" : "light",
  };
}

/** Monogram a jelvényhez, ha nincs logó: „MM Cars Kft” → „MMC”. */
export function monogram(name: string) {
  const words = name.replace(/\b(kft|bt|zrt|nyrt|kkt|ev)\.?\b/gi, "").split(/\s+/).filter(Boolean);
  return (words.length >= 2 ? words.slice(0, 3).map((w) => w[0]) : [name.slice(0, 3)]).join("").toUpperCase();
}
