import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { tasksRoutes } from './routes/tasks.js';
import { shoppingRoutes } from './routes/shopping.js';
import { chatRoutes } from './routes/chat.js';
import { layoutRoutes } from './routes/layout.js';
import { authPlugin } from './lib/auth.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'production' ? undefined : {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l' },
    },
  },
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
});
await app.register(cookie, { secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me' });
await app.register(authPlugin);

app.get('/health', async () => ({ status: 'ok', service: 'hallakompis-api', time: new Date().toISOString() }));

await app.register(authRoutes, { prefix: '/auth' });
await app.register(meRoutes, { prefix: '/me' });
await app.register(tasksRoutes, { prefix: '/tasks' });
await app.register(shoppingRoutes, { prefix: '/family/shopping' });
await app.register(chatRoutes, { prefix: '/chat' });
await app.register(layoutRoutes, { prefix: '/me/layout' });

{
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const { sql } = await import('drizzle-orm');
  const postgresMod = await import('postgres');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const fs = await import('node:fs');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(__dirname, '../../../packages/db/drizzle');

  const migrationClient = postgresMod.default(
    process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!,
    { max: 1 }
  );
  const mdb = drizzle(migrationClient);

  if (process.env.MIGRATION_RESET === 'true') {
    app.log.warn('MIGRATION_RESET=true — dropper public og drizzle-skjemaet');
    await mdb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await mdb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await mdb.execute(sql`CREATE SCHEMA public`);
  }

  try {
    const files = fs.readdirSync(migrationsFolder);
    app.log.info(`Innhold i migrations-mappa: ${JSON.stringify(files)}`);
  } catch (e) {
    app.log.error(`Kan ikke lese migrations-mappa: ${(e as Error).message}`);
  }

  app.log.info(`Kjører migrasjoner fra ${migrationsFolder}`);
  await migrate(mdb, { migrationsFolder });
  await migrationClient.end();
  app.log.info('Migrasjoner ferdig');
}

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info(`Kompis API er klar på http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
