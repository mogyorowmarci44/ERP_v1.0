import { requireCompany } from "@/lib/auth";
import { PRESETS, normalizeTheme, themeVars, type ThemePreset } from "@/lib/themes";
import { saveThemeAction, uploadLogoAction, removeLogoAction } from "../actions";
import { Flash } from "@/components/Flash";
import { CompanyMark, Plate } from "@/components/Brand";
import { monogram } from "@/lib/themes";

/** Kicsinyített felület-előnézet egy témához. */
function Mini({ t }: { t: ThemePreset | ReturnType<typeof normalizeTheme> }) {
  const v = themeVars(t);
  return (
    <div className="mini" aria-hidden="true" style={{ background: v["--bg"] }}>
      <div className="ms" style={{ background: v["--side"] }}>
        <i className="a" style={{ background: t.accent, width: "70%" }} />
        <i style={{ background: v["--side-ink"], width: "85%" }} />
        <i style={{ background: v["--side-ink"], width: "60%" }} />
        <i style={{ background: v["--side-ink"], width: "75%" }} />
      </div>
      <div className="mm">
        <div className="bar" style={{ background: v["--ink"], width: "55%", opacity: 0.8 }} />
        <div className="row" style={{ gap: 5, flexWrap: "nowrap" }}>
          <div className="tile" style={{ background: t.accent, flex: 1 }} />
          <div className="tile" style={{ background: v["--surface"], flex: 1, border: `1px solid ${v["--line"]}` }} />
        </div>
        <div className="tile" style={{ background: v["--surface"], border: `1px solid ${v["--line"]}` }} />
      </div>
    </div>
  );
}

export default async function AppearancePage({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<Record<string, string>> }) {
  const cid = Number((await params).cid);
  const sp = await searchParams;
  const { company, role } = await requireCompany(cid);
  const current = normalizeTheme(company.theme);
  const owner = role === "owner";
  return (
    <>
      <h1>Megjelenés</h1>
      <Flash error={sp.error} ok={sp.ok} />
      {!owner && <p className="muted">A megjelenést a cég tulajdonosa állíthatja be.</p>}

      <h2>Logó</h2>
      <div className="card row" style={{ gap: 24, alignItems: "center" }}>
        <div style={{ background: "var(--side)", padding: 16, borderRadius: 12 }}>
          <CompanyMark id={company.id} name={company.name} logoVersion={company.logoUpdatedAt ? company.logoUpdatedAt.getTime() : null} />
        </div>
        <form action={uploadLogoAction} className="row" encType="multipart/form-data">
          <input type="hidden" name="cid" value={cid} />
          <label>Logófájl (PNG, JPG, WebP vagy SVG, max. 400 KB)
            <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" required disabled={!owner} />
          </label>
          <button className="primary" style={{ alignSelf: "end" }} disabled={!owner}>Logó feltöltése</button>
        </form>
        {company.logoUpdatedAt && (
          <form action={removeLogoAction}>
            <input type="hidden" name="cid" value={cid} />
            <button className="danger" disabled={!owner}>Logó eltávolítása</button>
          </form>
        )}
        {!company.logoUpdatedAt && (
          <p className="muted" style={{ margin: 0 }}>
            Logó nélkül a cég rendszámtábla-jelvényt kap a monogramjával: <Plate text={monogram(company.name)} />
          </p>
        )}
      </div>

      <h2>Témák</h2>
      <p className="muted">Kattints egy témára – az egész felület azonnal átszíneződik ennél a cégnél. Minden cégnek saját témája lehet.</p>
      <div className="theme-gallery">
        {PRESETS.map((p) => (
          <form action={saveThemeAction} key={p.preset}>
            <input type="hidden" name="cid" value={cid} />
            <input type="hidden" name="preset" value={p.preset} />
            <button type="submit" className={`theme-card${current.preset === p.preset ? " on" : ""}`} disabled={!owner} aria-pressed={current.preset === p.preset}>
              <Mini t={p} />
              <span className="name">{p.name}{current.preset === p.preset ? " – aktív" : ""}</span>
              <span className="note">{p.note}{p.mode === "dark" ? " (sötét)" : ""}</span>
            </button>
          </form>
        ))}
      </div>

      <h2>Egyedi színek</h2>
      <form action={saveThemeAction} className="card row" style={{ gap: 20, alignItems: "end" }}>
        <input type="hidden" name="cid" value={cid} />
        <label>Kiemelő szín<input type="color" name="accent" defaultValue={current.accent} /></label>
        <label>Oldalsáv színe<input type="color" name="sidebar" defaultValue={current.sidebar} /></label>
        <label>Mód
          <select name="mode" defaultValue={current.mode}>
            <option value="light">világos</option>
            <option value="dark">sötét</option>
          </select>
        </label>
        <div style={{ width: 200 }}><Mini t={current} /></div>
        <button className="primary" disabled={!owner}>Egyedi színek mentése</button>
      </form>
    </>
  );
}
