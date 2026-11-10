"use client";
import { useFormStatus } from "react-dom";

/** Beküldő gomb, amely a szerveroldali művelet alatt letiltódik és jelzi a folyamatot. */
export function SubmitButton({ children, pendingText, className }: { children: React.ReactNode; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-busy={pending}>
      {pending ? <><span className="spinner" aria-hidden /> {pendingText ?? "Folyamatban…"}</> : children}
    </button>
  );
}
