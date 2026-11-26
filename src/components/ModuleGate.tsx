import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { MODULES, moduleOn, type ModuleKey } from "@/lib/modules";

/** v6.2.0 – Kikapcsolt modul oldalai nem nyílnak meg (az adatok megmaradnak). */
export async function ModuleGate({ cid, module, children }: { cid: string; module: ModuleKey; children: React.ReactNode }) {
  const { company, role } = await requireCompany(Number(cid));
  if (moduleOn(company, module)) return <>{children}</>;
  const def = MODULES.find((m) => m.key === module)!;
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h1>{def.label}</h1>
      <p>Ez a modul ennél a cégnél ki van kapcsolva. Az adatai megmaradtak – visszakapcsolás után újra elérhetők.</p>
      {role === "owner"
        ? <p><Link href={`/c/${cid}/settings#modulok`}>Modulok bekapcsolása a Beállításokban →</Link></p>
        : <p className="muted">Bekapcsolni a cég tulajdonosa tudja a Beállítások oldalon.</p>}
    </div>
  );
}
