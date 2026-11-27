import { ModuleGate } from "@/components/ModuleGate";

/** v6.2.0 – csak bekapcsolt „memberLoans” modulnál nyílik meg. */
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ cid: string }> }) {
  return <ModuleGate cid={(await params).cid} module="memberLoans">{children}</ModuleGate>;
}
