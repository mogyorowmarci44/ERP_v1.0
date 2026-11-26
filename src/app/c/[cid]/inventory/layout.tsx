import { ModuleGate } from "@/components/ModuleGate";

/** v6.3.0 – csak bekapcsolt „inventory” modulnál nyílik meg. */
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ cid: string }> }) {
  return <ModuleGate cid={(await params).cid} module="inventory">{children}</ModuleGate>;
}
