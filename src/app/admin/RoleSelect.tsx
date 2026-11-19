"use client";

/** Szerepkör-választó a hozzáférési mátrix egy cellájában: választáskor azonnal ment; elvételnél megerősítést kér. */
export function RoleSelect({ value, label }: { value: string; label: string }) {
  return (
    <select
      name="role"
      defaultValue={value}
      aria-label={label}
      className={value === "none" ? "role-none" : value === "owner" ? "role-owner" : undefined}
      onChange={(e) => {
        const sel = e.currentTarget;
        if (sel.value === "none" && !window.confirm(`${label}: biztosan megvonod a hozzáférést?`)) {
          sel.value = value;
          return;
        }
        sel.form?.requestSubmit();
      }}
    >
      <option value="none">– nincs –</option>
      <option value="owner">tulajdonos</option>
      <option value="accountant">könyvelő</option>
      <option value="viewer">CEO - Ügyvezető</option>
    </select>
  );
}
