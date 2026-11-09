/**
 * Import csomag betöltése parancssorból (teszteléshez / helyi futtatáshoz).
 *   DATABASE_URL=... npx tsx scripts/import-bundle.ts <csomag.json> <cégnév> <felhasználó e-mail>
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, sql, schema } from "../src/db";
import { createCompany } from "../src/lib/ledger";
import { importBundle, type ImportBundle } from "../src/lib/importer";

async function main() {
  const [file, name, email] = process.argv.slice(2);
  const bundle = JSON.parse(readFileSync(file, "utf8")) as ImportBundle;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) throw new Error("Nincs ilyen felhasználó: " + email);
  const c = await createCompany(user.id, { name });
  const t0 = Date.now();
  const rep = await importBundle(c.id, bundle, user.id);
  console.log(JSON.stringify({ companyId: c.id, seconds: (Date.now() - t0) / 1000, ...rep }, null, 1));
  await sql.end();
}
main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
