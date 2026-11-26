import "server-only";
import { gzipSync, gunzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { ENCRYPTED_COLUMNS, decryptField, encryptField } from "@/lib/field-crypto";
import journal from "../../drizzle/meta/_journal.json";
import { APP_VERSION } from "@/lib/version";

/**
 * v6.1.0 – Teljes cégmentés és visszaállítás.
 *
 * A mentés a cég MINDEN adatát tartalmazza (könyvelés, számlák, bizonylatfájlok, bér, eszközök, forecast, beállítások, logó),
 * az eredeti azonosítókkal. Visszaállításkor a sorok ugyanazokkal az azonosítókkal kerülnek vissza – így minden belső
 * hivatkozás (pl. tétel → számla) változatlanul érvényes. Ezért csak olyan cég állítható vissza, amely nincs az adatbázisban
 * (véglegesen törölt cég, vagy katasztrófa után új, üres adatbázis).
 *
 * Nem kerül bele: tevékenységnapló, hozzáférések (memberships), támogatói hozzáférések, felhasználók – ezek az ügyfélfiókhoz tartoznak.
 */
export const BACKUP_FORMAT = "mogyorosi.erp/backup";
export const BACKUP_FORMAT_VERSION = 1;
const EXCLUDE = new Set(["audit_log", "memberships", "support_grants"]);

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  /** A mentéskori adatbázis-séma (az utolsó lefutott migráció sorszáma). */
  schemaVersion: number;
  createdAt: string;
  company: { id: number; name: string };
  tables: Record<string, Record<string, unknown>[]>;
};

type TableInfo = { name: string; cols: string[]; notNull: Set<string>; serialPk: boolean; parent: { col: string; table: string } | null; deps: string[]; userCols: string[] };

export const currentSchemaVersion = () => Math.max(...journal.entries.map((e) => e.idx));

/** A mentendő táblák függőségi sorrendben (szülő előbb). A sémából számolva – új tábla automatikusan bekerül. */
export function backupTables(): TableInfo[] {
  const all = (Object.values(schema) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));
  const coTables = new Set(all.filter((c) => c.name !== "companies" && c.columns.some((x) => x.name === "company_id") && !EXCLUDE.has(c.name)).map((c) => c.name));
  const infos: TableInfo[] = [];
  for (const c of all) {
    const fks = c.foreignKeys.map((f) => { const r = f.reference(); return { col: r.columns[0].name, table: getTableConfig(r.foreignTable).name }; });
    const isCo = c.name === "companies" || coTables.has(c.name);
    // gyerektábla company_id nélkül, amely egy cégtáblára hivatkozik (pl. invoice_lines → invoices)
    const parent = !isCo ? fks.find((f) => coTables.has(f.table)) ?? null : null;
    if (!isCo && !parent) continue;
    if (EXCLUDE.has(c.name)) continue;
    infos.push({
      name: c.name,
      cols: c.columns.map((x) => x.name),
      notNull: new Set(c.columns.filter((x) => x.notNull).map((x) => x.name)),
      serialPk: c.columns.some((x) => x.primary && x.name === "id" && /Serial/.test(x.columnType)),
      parent,
      deps: [...new Set(fks.map((f) => f.table))],
      userCols: fks.filter((f) => f.table === "users").map((f) => f.col),
    });
  }
  // topologikus sorrend
  const names = new Set(infos.map((i) => i.name));
  const done = new Set<string>();
  const out: TableInfo[] = [];
  const visit = (i: TableInfo, stack: Set<string>) => {
    if (done.has(i.name)) return;
    if (stack.has(i.name)) throw new Error(`Körkörös hivatkozás a táblák között: ${[...stack, i.name].join(" → ")}`);
    stack.add(i.name);
    for (const d of i.deps) if (d !== i.name && names.has(d)) visit(infos.find((x) => x.name === d)!, stack);
    stack.delete(i.name);
    done.add(i.name);
    out.push(i);
  };
  for (const i of infos) visit(i, new Set());
  return out;
}

function whereFor(t: TableInfo, cid: number) {
  if (t.name === "companies") return sql`id = ${cid}`;
  if (!t.parent) return sql`company_id = ${cid}`;
  return sql`${sql.identifier(t.parent.col)} in (select id from ${sql.identifier(t.parent.table)} where company_id = ${cid})`;
}

/** A cég teljes mentése (objektum). */
export async function buildBackup(cid: number): Promise<BackupFile> {
  const tables: BackupFile["tables"] = {};
  let name = "";
  for (const t of backupTables()) {
    const [r] = (await db.execute(sql`select coalesce(json_agg(x order by ${sql.raw(t.serialPk ? "x.id" : "1")}), '[]'::json) as rows from ${sql.identifier(t.name)} x where ${whereFor(t, cid)}`)) as unknown as Array<{ rows: Record<string, unknown>[] }>;
    const rows = r.rows;
    for (const col of ENCRYPTED_COLUMNS[t.name] ?? []) for (const row of rows) if (typeof row[col] === "string") row[col] = decryptField(row[col] as string);
    if (t.name === "companies") name = String(rows[0]?.name ?? "");
    tables[t.name] = rows;
  }
  if (!tables.companies?.length) throw new Error("A cég nem található.");
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, appVersion: APP_VERSION, schemaVersion: currentSchemaVersion(), createdAt: new Date().toISOString(), company: { id: cid, name }, tables };
}

export const backupToGzip = (b: BackupFile) => gzipSync(Buffer.from(JSON.stringify(b)), { level: 6 });

/** Fájl → mentés objektum (.json.gz vagy .json), formai ellenőrzéssel. */
export function parseBackup(buf: Buffer): BackupFile {
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
  let b: BackupFile;
  try {
    b = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("A fájl nem olvasható mentés (sérült vagy nem mogyorosi.erp mentés).");
  }
  if (b?.format !== BACKUP_FORMAT || typeof b.tables !== "object" || !Array.isArray(b.tables.companies) || b.tables.companies.length !== 1)
    throw new Error("A fájl nem mogyorosi.erp cégmentés.");
  if (b.formatVersion > BACKUP_FORMAT_VERSION) throw new Error("A mentés újabb programverzióval készült – előbb frissítsd az ERP-t.");
  if (b.schemaVersion > currentSchemaVersion()) throw new Error(`A mentés újabb adatbázis-sémával készült (${b.schemaVersion} > ${currentSchemaVersion()}) – előbb frissítsd az ERP-t.`);
  return b;
}

export type RestoreReport = { companyId: number; name: string; rows: number; tables: number };

/**
 * Visszaállítás az eredeti azonosítókkal, egy tranzakcióban (hiba esetén semmi nem változik).
 * A cég a megadott ügyfélfiókba kerül, a visszaállító felhasználó tulajdonos lesz. A nem létező felhasználókra
 * mutató mezők (pl. „ki könyvelte”) üresek lesznek, illetve kötelező mezőnél a visszaállítóra mutatnak.
 */
export async function restoreBackup(b: BackupFile, opts: { organizationId: number; userId: number }): Promise<RestoreReport> {
  const cid = Number(b.tables.companies[0].id);
  const tables = backupTables();
  const known = new Map(tables.map((t) => [t.name, t]));
  for (const name of Object.keys(b.tables)) if (!known.has(name)) throw new Error(`A mentés ismeretlen táblát tartalmaz: ${name}.`);
  return db.transaction(async (tx) => {
    const [exists] = (await tx.execute(sql`select 1 as x from companies where id = ${cid}`)) as unknown as unknown[];
    if (exists) throw new Error(`Ez a cég (#${cid}) még megvan az adatbázisban – visszaállítani csak véglegesen törölt céget lehet. Archivált cégnél használd a „Visszaállítás” gombot a Cégeim oldalon.`);
    const users = new Set(((await tx.execute(sql`select id from users`)) as unknown as Array<{ id: number }>).map((u) => u.id));
    let total = 0;
    let used = 0;
    for (const t of tables) {
      const rows = b.tables[t.name] ?? [];
      if (!rows.length) continue;
      used++;
      const present = new Set<string>();
      for (const row of rows) {
        if (t.name === "companies") { row.organization_id = opts.organizationId; row.archived_at = null; row.archived_by = null; }
        for (const col of t.userCols) {
          if (row[col] == null || users.has(Number(row[col]))) continue;
          row[col] = t.notNull.has(col) ? opts.userId : null;
        }
        for (const col of ENCRYPTED_COLUMNS[t.name] ?? []) if (typeof row[col] === "string") row[col] = encryptField(row[col] as string);
        for (const k of Object.keys(row)) {
          if (!t.cols.includes(k)) throw new Error(`A mentés „${t.name}.${k}” mezője az aktuális sémában nem létezik.`);
          present.add(k);
        }
      }
      const cols = [...present];
      const colList = sql.join(cols.map((c) => sql.identifier(c)), sql`, `);
      // 500-as csomagokban (a bizonylatfájlok nagyok lehetnek)
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = JSON.stringify(rows.slice(i, i + 500));
        await tx.execute(sql`insert into ${sql.identifier(t.name)} (${colList}) select ${colList} from json_populate_recordset(null::${sql.identifier(t.name)}, ${chunk}::json)`);
      }
      if (t.serialPk) await tx.execute(sql`select setval(pg_get_serial_sequence(${t.name}, 'id'), greatest((select max(id) from ${sql.identifier(t.name)}), 1))`);
      total += rows.length;
    }
    await tx.insert(schema.memberships).values({ userId: opts.userId, companyId: cid, role: "owner" }).onConflictDoNothing();
    return { companyId: cid, name: String(b.tables.companies[0].name ?? b.company.name), rows: total, tables: used };
  });
}
