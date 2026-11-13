import Link from "next/link";
import {
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
  Scale,
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
  Inbox,
  Landmark,
  NotebookTabs,
  CalendarDays,
  Star,
  ReceiptText,
} from "lucide-react";
import { isPrivate } from "@/lib/entity";
import { APP_VERSION } from "@/lib/version";
import { requireCompany } from "@/lib/auth";
import { logoutAction } from "@/app/auth-actions";
import { NavLink } from "@/components/NavLink";
import { CompanyMark } from "@/components/Brand";
import { normalizeTheme, themeVars } from "@/lib/themes";

export const dynamic = "force-dynamic";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company, user } = await requireCompany(Number(cid));
  const b = `/c/${cid}`;
  const theme = normalizeTheme(company.theme);
  const priv = isPrivate(company);
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

          <div className="group">Adók</div>
          <NavLink href={`${b}/taxes`}><Landmark />Adók (TFH, IFA, tételes, ÁFA-keret)</NavLink>
          <NavLink href={`${b}/reports/cashbook`}><NotebookTabs />Bevételi-kiadási nyilvántartás</NavLink>

          <div className="group">Rendszer</div>
          <NavLink href={`${b}/partners`}><Users />Partnerek</NavLink>
          <NavLink href={`${b}/appearance`}><Palette />Megjelenés</NavLink>
          <NavLink href={`${b}/settings`}><Settings />Beállítások</NavLink>
          <NavLink href={`${b}/import`}><Upload />Adatimport</NavLink>
          </>
        ) : (
          <>
          <NavLink href={b} exact><LayoutDashboard />Áttekintés</NavLink>

          <div className="group">Bizonylatok</div>
          <NavLink href={`${b}/inbox`}><Inbox />Beérkező bizonylatok</NavLink>
          <NavLink href={`${b}/invoices?dir=out`} exact><FileOutput />Vevőszámlák</NavLink>
          <NavLink href={`${b}/invoices?dir=in`} exact><FileInput />Szállítói számlák</NavLink>
          <NavLink href={`${b}/invoices/new?dir=out`} exact><FilePlus2 />Új vevőszámla</NavLink>
          <NavLink href={`${b}/invoices/new?dir=in`} exact><FilePlus2 />Új szállítói számla</NavLink>
          <NavLink href={`${b}/journal/new`} exact><BookPlus />Vegyes / bank tétel</NavLink>

          <div className="group">Pénzügy</div>
          <NavLink href={`${b}/money`}><Wallet />Pénztár és bank</NavLink>
          <NavLink href={`${b}/member-loans`}><HandCoins />Tagi kölcsön</NavLink>

          <div className="group">Tervezés</div>
          <NavLink href={`${b}/forecast`}><TrendingUp />Forecast</NavLink>

          <div className="group">Kimutatások</div>
          <NavLink href={`${b}/reports/statements`}><ChartNoAxesCombined />P&amp;L, cash-flow, mérleg</NavLink>
          <NavLink href={`${b}/reports/trial-balance`}><Scale />Főkönyvi kivonat</NavLink>
          <NavLink href={`${b}/reports/vat`}><Percent />ÁFA analitika</NavLink>
          <NavLink href={`${b}/reports/open-items`}><Clock />Nyitott tételek</NavLink>

          <div className="group">Főkönyv</div>
          <NavLink href={`${b}/journal`} exact><BookOpen />Napló</NavLink>
          <NavLink href={`${b}/reports/ledger`}><FileSpreadsheet />Számlakarton</NavLink>

          <div className="group">Törzsadatok</div>
          <NavLink href={`${b}/vehicles`}><CarFront />Gépkocsi készlet</NavLink>
          <NavLink href={`${b}/partners`}><Users />Partnerek</NavLink>
          <NavLink href={`${b}/accounts`}><ListTree />Számlatükör</NavLink>
          <NavLink href={`${b}/fx`}><Coins />Árfolyamok (MNB)</NavLink>

          <div className="group">Rendszer</div>
          <NavLink href={`${b}/appearance`}><Palette />Megjelenés</NavLink>
          <NavLink href={`${b}/settings`}><Settings />Beállítások</NavLink>
          <NavLink href={`${b}/import`}><Upload />Adatimport</NavLink>
          </>
        )}
        </div>
        <div className="foot">
          <span>Bejelentkezve: {user.name} · <span className="version-tag">v{APP_VERSION}</span></span>
          <form action={logoutAction}><button>Kilépés</button></form>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
