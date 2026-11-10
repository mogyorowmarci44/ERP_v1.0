"use client";
export function PrintButton({ label = "Nyomtatás / PDF" }: { label?: string }) {
  return <button className="primary no-print" onClick={() => window.print()}>{label}</button>;
}
