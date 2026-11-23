import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL nincs beállítva");
  const client = postgres(url, { max: 1, prepare: false });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("Migrációk lefutottak.");
  // v3.9.6 – egyszeri, idempotens adatjavítások (az app_settings.dataFixes-ben nyilvántartva)
  const { runDataFixes } = await import("./data-fixes");
  await runDataFixes();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
