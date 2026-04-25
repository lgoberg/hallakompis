import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://hallakompis:hallakompis@localhost:5432/hallakompis',
  },
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
});