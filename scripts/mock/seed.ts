/**
 * Seeds the mock dataset (scripts/mock/data.ts) into DATABASE_URL; refuses if already seeded.
 *   bun run seed:mock
 */
import { createSql, migrate } from "@memegen/server-kit";
import { assetStoreFromEnv } from "@memegen/storage";
import { MOCK_AUTHORS, MOCK_MEMES, MOCK_TEMPLATES } from "./data.ts";
import { isSeeded, seedMockData } from "./seed-data.ts";

const sql = createSql();
try {
  await migrate(sql);
  if (await isSeeded(sql)) {
    console.log(`mock data already present (user ${MOCK_AUTHORS[0]} exists); nothing to do`);
  } else {
    await seedMockData(sql, assetStoreFromEnv(sql));
    console.log(`mock data seeded: ${MOCK_AUTHORS.length} authors, ${MOCK_TEMPLATES.length} templates, ${MOCK_MEMES.length} memes`);
  }
} finally {
  await sql.end();
}
