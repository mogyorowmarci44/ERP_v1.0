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
} from "lucide-react";
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
        <NavLink href={b} exact><LayoutDashboard />Áttekintés</NavLink>

        <div className="group">Bizonylatok</div>
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

        </div>
        <div className="foot">
          <span>Bejelentkezve: {user.name}</span>
          <form action={logoutAction}><button>Kilépés</button></form>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
