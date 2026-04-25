import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });

import postgres from 'postgres';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  console.log('🧹 Nullstiller public-skjemaet...');
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  await sql`DROP SCHEMA IF EXISTS public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql.end();
  console.log('✓ Schema nullstilt');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});