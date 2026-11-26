/**
 * v6.1.0 – A még titkosítatlan érzékeny mezők titkosítása (minden migráció után fut, idempotens).
 * Ha nincs DATA_ENCRYPTION_KEY, nem csinál semmit.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { ENCRYPTED_COLUMNS, ENC_PREFIX, encryptField, encryptionKey } from "../src/lib/field-crypto";

export async function encryptPersonalFields(): Promise<void> {
  const key = encryptionKey();
  if (!key) {
    console.log("Személyes adatok titkosítása: kihagyva (nincs DATA_ENCRYPTION_KEY).");
    return;
  }
  let n = 0;
  for (const [table, cols] of Object.entries(ENCRYPTED_COLUMNS)) {
    for (const col of cols) {
      const rows = (await db.execute(
        sql`select id, ${sql.identifier(col)} as v from ${sql.identifier(table)} where ${sql.identifier(col)} is not null and ${sql.identifier(col)} <> '' and ${sql.identifier(col)} not like ${ENC_PREFIX + "%"}`,
      )) as unknown as Array<{ id: number; v: string }>;
      for (const r of rows) {
        await db.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(col)} = ${encryptField(r.v, key)} where id = ${r.id}`);
        n++;
      }
    }
  }
  console.log(`Személyes adatok titkosítása: ${n} mező titkosítva.`);
}
