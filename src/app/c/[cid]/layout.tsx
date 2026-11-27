import Link from "next/link";
import {
  Mail,
  Gauge,
  ShieldCheck,
  ListChecks,
  LayoutDashboard,
  FileOutput,
  FileInput,
  FilePlus2,
  BookPlus,
  Users,
  CarFront,
  ListTree,
  Coins,
  BookOpen,
  FileSpreadsheet,
  Clock,
  Percent,
  ChartNoAxesCombined,
  Palette,
  Settings,
  Upload,
  Wallet,
  HandCoins,
  TrendingUp,
  Tag,
  Scale,
  Inbox,
  Landmark,
  NotebookTabs,
  CalendarDays,
  Star,
  ReceiptText,
  Recycle,
  BookOpenCheck,
  Package,
  Boxes,
  Rocket,
  BadgeEuro,
  FileCheck2,
} from "lucide-react";
import { isPrivate } from "@/lib/entity";
import { moduleVisible, type ModuleKey } from "@/lib/modules";
import { APP_VERSION } from "@/lib/version";
import { requireCompany } from "@/lib/auth";
import { isDemo } from "@/lib/demo";
import { deleteDemoCompanyAction } from "@/app/auth-actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { HelpLink } from "@/components/HelpLink";
import { logoutAction } from "@/app/auth-actions";
import { NavLink } from "@/components/NavLink";
import { CompanyMark, AppFooter } from "@/components/Brand";
import { UnitSwitcher } from "@/components/UnitSwitcher";
import { normalizeTheme, themeVars } from "@/lib/themes";
import { orgAccess } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company, user, support, hidden, role } = await requireCompany(Number(cid));
  const access = await orgAccess(company.organizationId); // v6.8.0
  const b = `/c/${cid}`;
  const theme = normalizeTheme(company.theme);
  const priv = isPrivate(company);
  // v6.2.0 – a menü a cég modulkapcsolói szerint (a profil csak alapértelmezés)
  const on = (k: ModuleKey) => moduleVisible(company, hidden, k); // v6.11.0 – felhasználónként elrejtett modulok
  const car = on("vehicles");
  return (
    <div className="shell" style={themeVars(theme) as React.CSSProperties} data-mode={theme.mode}>
      <nav className="side" aria-label="Fő navigáció">
        <div className="identity">
          <Link href={b} style={{ textDecoration: "none" }}>
            <CompanyMark id={company.id} name={company.name} logoVersion={company.logoUpdatedAt ? company.logoUpdatedAt.getTime() : null} />
          </Link>
          <div>
            <div className="company-name">{company.name}</div>
            <Link href="/" className="switch">Másik cég kiválasztása</Link>
          </div>
        </div>

        {/* v7.4.0 – globális kereső */}
        <form action="/kereses" className="side-search" role="search">
          <input type="hidden" name="from" value={b} />
          <input name="q" placeholder="Keresés (számla, partner, összeg…)" aria-label="Keresés" />
        </form>
        <input type="checkbox" id="navtoggle" className="navtoggle" />
        <label htmlFor="navtoggle" className="menu-btn">Menü</label>
        <div className="navlinks">
        {priv ? (
          <>
          <NavLink href={b} exact><LayoutDashboard />Áttekintés</NavLink>

          <div className="group">Elemzés</div>
          <NavLink href={`${b}/gh/pnl`}><ChartNoAxesCombined />Eredmény (P&amp;L)</NavLink>
          <NavLink href={`${b}/gh/cashflow`}><Wallet />Cash flow</NavLink>
          <NavLink href={`${b}/gh/payback`}><TrendingUp />Megtérülés</NavLink>
          <NavLink href={`${b}/gh/bookings`}><CalendarDays />Foglalások</NavLink>
          <NavLink href={`${b}/gh/reviews`}><Star />Értékelések</NavLink>

          <div className="group">Rögzítés</div>
          <NavLink href={`${b}/gh/costs`}><ReceiptText />Költség rögzítése</NavLink>
          <NavLink href={`${b}/inbox`}><Inbox />Beérkező bizonylatok</NavLink>
          <NavLink href={`${b}/invoices?dir=out`} exact><FileOutput />Bevételi bizonylatok</NavLink>
          <NavLink href={`${b}/invoices?dir=in`} exact><FileInput />Kiadási bizonylatok</NavLink>
          <NavLink href={`${b}/reports/open-items`}><Clock />Nyitott tételek</NavLink>
          <NavLink href={`${b}/reports/consistency`}><ListChecks />Egyezőség</NavLink>

          <div className="group">Adók</div>
          <NavLink href={`${b}/taxes`}><Landmark />Adók (TFH, IFA, tételes, ÁFA-keret)</NavLink>
          <NavLink href={`${b}/reports/cashbook`}><NotebookTabs />Bevételi-kiadási nyilvántartás</NavLink>

          <div className="group">Rendszer</div>
          <NavLink href={`${b}/partners`}><Users />Partnerek</NavLink>
          <NavLink href={`${b}/appearance`}><Palette />Megjelenés</NavLink>
          <NavLink href={`${b}/settings`}><Settings />Beállítások</NavLink>
          <NavLink href={`${b}/import`}><Upload />Adatimport / export</NavLink>
          {user.isAdmin && <NavLink href="/admin"><ShieldCheck />Admin – hozzáférések</NavLink>}
          </>
        ) : (
          <>
          <NavLink href={b} exact><LayoutDashboard />Áttekintés</NavLink>

          <div className="group">Bizonylatok</div>
          {on("inbox") && <NavLink href={`${b}/inbox`}><Inbox />Beérkező bizonylatok</NavLink>}
          <NavLink href={`${b}/invoices?dir=out`} exact><FileOutput />Vevőszámlák</NavLink>
          <NavLink href={`${b}/invoices?dir=in`} exact><FileInput />Szállítói számlák</NavLink>
          <NavLink href={`${b}/invoices/new?dir=out`} exact><FilePlus2 />Új vevőszámla</NavLink>
          <NavLink href={`${b}/invoices/new?dir=in`} exact><FilePlus2 />Új szállítói számla</NavLink>
          <NavLink href={`${b}/journal/new`} exact><BookPlus />Vegyes / bank tétel</NavLink>

          <div className="group">Pénzügy</div>
          <NavLink href={`${b}/money`}><Wallet />Pénztár és bank</NavLink>
          {on("memberLoans") && <NavLink href={`${b}/member-loans`}><HandCoins />Tagi kölcsön</NavLink>}
          {on("payroll") && <NavLink href={`${b}/payroll`}><BadgeEuro />Bérszámfejtés</NavLink>}
          {on("filings") && <NavLink href={`${b}/filings`}><FileCheck2 />NAV-bevallások (ÁNYK)</NavLink>}

          {(on("forecast") || car) && <div className="group">Tervezés</div>}
          {on("forecast") && <NavLink href={`${b}/forecast`}><TrendingUp />Forecast</NavLink>}
          {car && <NavLink href={`${b}/arsugo`}><Tag />ÁrSugó</NavLink>}

          <div className="group">Kimutatások</div>
          <NavLink href={`${b}/reports/kpi`}><Gauge />KPI-Dashboard</NavLink>
          <NavLink href={`${b}/reports/statements`}><ChartNoAxesCombined />P&amp;L, cash-flow, mérleg</NavLink>
          <NavLink href={`${b}/reports/cost-centers`}><ChartNoAxesCombined />Költséghelyek</NavLink>
          <NavLink href={`${b}/reports/vat`}><Percent />ÁFA analitika</NavLink>
          {car && <NavLink href={`${b}/vehicles/kartonok`}><ReceiptText />Különbözeti ÁFA kartonok</NavLink>}
          {car && <NavLink href={`${b}/vehicles/epr`}><Recycle />EPR összesítő</NavLink>}
          <NavLink href={`${b}/reports/open-items`}><Clock />Nyitott tételek</NavLink>
          <NavLink href={`${b}/reports/consistency`}><ListChecks />Egyezőség</NavLink>

          <div className="group">Főkönyv</div>
          <NavLink href={`${b}/journal`} exact><BookOpen />Napló</NavLink>
          <NavLink href={`${b}/reports/ledger`}><FileSpreadsheet />Számlakarton</NavLink>
          {on("assets") && <NavLink href={`${b}/assets`}><Package />Tárgyi eszközök</NavLink>}
          <NavLink href={`${b}/closing`}><BookOpenCheck />Évzárás</NavLink>

          <div className="group">Törzsadatok</div>
          {car && <NavLink href={`${b}/vehicles`} exact><CarFront />Gépkocsi készlet</NavLink>}
          {on("inventory") && <NavLink href={`${b}/inventory`}><Boxes />Készlet (cikkek)</NavLink>}
          {car && <NavLink href={`${b}/vehicles/merleg`}><Scale />KészletMérleg</NavLink>}
          <NavLink href={`${b}/partners`}><Users />Partnerek</NavLink>
          <NavLink href={`${b}/accounts`}><ListTree />Számlatükör</NavLink>
          {on("fx") && <NavLink href={`${b}/fx`}><Coins />Árfolyamok (MNB)</NavLink>}

          <div className="group">Rendszer</div>
          <NavLink href={`${b}/start`}><Rocket />Első lépések</NavLink>
          {on("summary") && <NavLink href={`${b}/summary`}><Mail />Napi összefoglaló</NavLink>}
          <NavLink href={`${b}/appearance`}><Palette />Megjelenés</NavLink>
          <NavLink href={`${b}/settings`}><Settings />Beállítások</NavLink>
          <NavLink href={`${b}/import`}><Upload />Adatimport / export</NavLink>
          {user.isAdmin && <NavLink href="/admin"><ShieldCheck />Admin – hozzáférések</NavLink>}
          </>
        )}
        </div>
        <div className="foot">
          <UnitSwitcher userId={user.id} currentId={company.id} />
          <span>Bejelentkezve: {user.name} · <span className="version-tag">v{APP_VERSION}</span></span>
          <HelpLink />
          <form action={logoutAction}><button>Kilépés</button></form>
        </div>
      </nav>
      <main className="main">
        {/* v6.0.0 – archivált cég / üzemeltetői támogatói hozzáférés jelzése */}
        {company.archivedAt && <div className="flash error" role="status">Archivált cég – csak olvasható. Visszaállítás a Cégeim oldalon (tulajdonosként).</div>}
        {(access.warn || !access.writable) && !support && (
          <div className="flash error" role="status">
            {access.writable ? (access.reason ?? `A próbaidő ${access.daysLeft} nap múlva lejár.`) : `${access.reason} Az ügyfélfiók csak olvasható.`}{" "}
            {user.isAdmin ? <a href="/admin/billing">Előfizetés →</a> : "Szólj az ügyfélfiók adminjának."}
          </div>
        )}
        {isDemo(company) && (
          <div className="flash demo-banner" role="status">
            <span><strong>Bemutató cég</strong> – mintaadatokkal. Nyugodtan próbálj ki bármit, nem kerül semmi a NAV-hoz.</span>
            {role === "owner" && (
              <form action={deleteDemoCompanyAction}><input type="hidden" name="companyId" value={company.id} /><ConfirmButton message="Biztosan törlöd a bemutató céget és minden adatát?" pendingText="Törlés…">Bemutató cég törlése</ConfirmButton></form>
            )}
          </div>
        )}
        {support && <div className="flash error" role="status">Támogatói hozzáférés (üzemeltető) – csak olvasás, időkorlátos, és az ügyfél tevékenységnaplójában is megjelenik.</div>}
        {children}
        <AppFooter company={company.name} version={APP_VERSION} darkMark={theme.mode === "dark"} />
      </main>
    </div>
  );
}
