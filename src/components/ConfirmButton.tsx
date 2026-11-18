"use client";
import { useFormStatus } from "react-dom";

/** Veszélyes (törlő / visszaállító) művelet beküldő gombja: beküldés előtt megerősítést kér, a művelet alatt letiltódik. */
export function ConfirmButton({ children, message, pendingText, className }: { children: React.ReactNode; message: string; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className ?? "danger"}
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {pending ? <><span className="spinner" aria-hidden /> {pendingText ?? "Folyamatban…"}</> : children}
    </button>
  );
}
