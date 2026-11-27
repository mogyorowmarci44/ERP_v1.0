/** v7.2.0 – a tárolóbeli mentések kulcsai (tiszta függvények). Formátum: backups/o{org}/c{cid}/{ÉÉÉÉ-HH-NN_ÓÓPPMM}.json.gz */
export const backupPrefix = (org: number) => `backups/o${org}/`;

export function backupKey(org: number, cid: number, at: Date): string {
  const s = at.toISOString(); // UTC – rendezhető
  return `${backupPrefix(org)}c${cid}/${s.slice(0, 10)}_${s.slice(11, 19).replace(/:/g, "")}.json.gz`;
}

export function parseBackupKey(key: string): { companyId: number | null; at: string | null } {
  const m = /\/c(\d+)\/(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})\.json\.gz$/.exec(key);
  return m ? { companyId: Number(m[1]), at: `${m[2]}T${m[3]}:${m[4]}:${m[5]}Z` } : { companyId: null, at: null };
}

/** A törlendő (legrégebbi) kulcsok: a legutóbbi `keep` darab marad. */
export function pruneList(keys: string[], keep: number): string[] {
  return [...keys].sort().reverse().slice(keep);
}
