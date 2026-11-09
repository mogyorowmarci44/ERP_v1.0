import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { logoutAction } from "@/app/auth-actions";

export const dynamic = "force-dynamic";

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company, user } = await requireCompany(Number(cid));
  const b = `/c/${cid}`;
  return (
    <div className="shell">
      <nav className="side">
        <div className="brand"><Link href="/" style={{ color: "#fff" }}>MM ERP</Link></div>
        <div className="company">{company.name}<br />{user.name}</div>
        <Link href={b}>Áttekintés</Link>
        <div className="group">Bizonylatok</div>
        <Link href={`${b}/invoices?dir=out`}>Vevőszámlák</Link>
        <Link href={`${b}/invoices?dir=in`}>Szállítói számlák</Link>
        <Link href={`${b}/invoices/new?dir=out`}>+ Új vevőszámla</Link>
        <Link href={`${b}/invoices/new?dir=in`}>+ Új szállítói számla</Link>
        <Link href={`${b}/journal/new`}>+ Vegyes / bank tétel</Link>
        <div className="group">Törzsadatok</div>
        <Link href={`${b}/partners`}>Partnerek</Link>
        <Link href={`${b}/vehicles`}>Gépkocsi készlet</Link>
        <Link href={`${b}/accounts`}>Számlatükör</Link>
        <div className="group">Főkönyv</div>
        <Link href={`${b}/journal`}>Napló</Link>
        <Link href={`${b}/reports/trial-balance`}>Főkönyvi kivonat</Link>
        <Link href={`${b}/reports/ledger`}>Számlakarton</Link>
        <Link href={`${b}/reports/open-items`}>Nyitott tételek</Link>
        <div className="group">ÁFA</div>
        <Link href={`${b}/reports/vat`}>ÁFA analitika</Link>
        <div className="group">Rendszer</div>
        <Link href={`${b}/settings`}>Beállítások</Link>
        <form action={logoutAction} style={{ padding: "8px 16px" }}><button style={{ width: "100%" }}>Kilépés</button></form>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
