/**
 * v6.0.0 – Cég archiválása és végleges törlése (tiszta függvények).
 * Archiválás előtt kötelező egy friss, teljes adatexport; archiválás után a cég csak olvasható,
 * és csak a türelmi idő letelte után törölhető véglegesen.
 */
export const EXPORT_MAX_AGE_HOURS = 24;
export const PURGE_GRACE_DAYS = 30;
const DAY = 86_400_000;

/** Archiválható-e: volt-e teljes export az elmúlt 24 órában. */
export function exportFresh(lastFullExportAt: Date | null | undefined, now: Date): boolean {
  return !!lastFullExportAt && now.getTime() - lastFullExportAt.getTime() <= EXPORT_MAX_AGE_HOURS * 3_600_000 && lastFullExportAt <= now;
}

/** Mikortól törölhető véglegesen az archivált cég. */
export function purgeAvailableFrom(archivedAt: Date): Date {
  return new Date(archivedAt.getTime() + PURGE_GRACE_DAYS * DAY);
}

/** Véglegesen törölhető-e most. */
export function canPurge(archivedAt: Date | null | undefined, now: Date): boolean {
  return !!archivedAt && purgeAvailableFrom(archivedAt) <= now;
}

/** Hány nap van még hátra a végleges törlésig (0 = már törölhető). */
export function daysUntilPurge(archivedAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((purgeAvailableFrom(archivedAt).getTime() - now.getTime()) / DAY));
}
