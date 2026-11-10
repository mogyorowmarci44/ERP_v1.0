/** Gépkocsi azonosító: rendszám, ha van; egyébként az alvázszám (nem minden eladás rendszámmal történik). */
export function vehicleIdent(v: { plate?: string | null; vin?: string | null }): string {
  const plate = v.plate?.trim();
  if (plate) return plate;
  const vin = v.vin?.trim();
  return vin ? vin : "";
}
/** „Gyártmány Típus (azonosító)” címke. */
export function vehicleTitle(v: { make: string; model: string; plate?: string | null; vin?: string | null }): string {
  const id = vehicleIdent(v);
  return `${v.make} ${v.model}${id ? ` (${id})` : ""}`;
}
