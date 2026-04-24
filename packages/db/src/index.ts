import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Last .env fra repo-roten (hvis ikke allerede lastet)
if (!process.env.DATABASE_URL) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  config({ path: resolve(__dirname, '../../../.env') });
}

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

// Connection pool
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export * from './schema/index.js';
export { sql } from 'drizzle-orm';
