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
import { voiceRoutes } from './voice/index.js';
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
await app.register(voiceRoutes, { prefix: '/voice' });

// ─── Migrasjoner ved oppstart ───
{
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const { sql } = await import('drizzle-orm');
  const postgresMod = await import('postgres');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

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

  app.log.info(`Kjører migrasjoner fra ${migrationsFolder}`);
  await migrate(mdb, { migrationsFolder });

  if (process.env.APP_DB_USER) {
    const u = sql.identifier(process.env.APP_DB_USER);
    await mdb.execute(sql`GRANT USAGE ON SCHEMA public TO ${u}`);
    await mdb.execute(sql`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${u}`);
    await mdb.execute(sql`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${u}`);
    await mdb.execute(sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${u}`);
    await mdb.execute(sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${u}`);
  }

  await migrationClient.end();
  app.log.info('Migrasjoner ferdig');
}

// ─── Engangs: oppdater familie-medlemmer ───
if (process.env.MIGRATE_MEMBERS === 'true') {
  const { db, users } = await import('@hallakompis/db');
  const { eq } = await import('drizzle-orm');

  app.log.info('MIGRATE_MEMBERS: oppdaterer medlemmer');

  // Goberg → Lars
  await db.update(users)
    .set({ name: 'Lars', displayName: 'Lars' })
    .where(eq(users.name, 'Goberg'));

  // Ida → AnneK
  await db.update(users)
    .set({ name: 'AnneK', displayName: 'AnneK' })
    .where(eq(users.name, 'Ida'));

  // Emma → Jes (gutt)
  await db.update(users)
    .set({ name: 'Jes', displayName: 'Jes' })
    .where(eq(users.name, 'Emma'));

  // Noah → Jack (gutt)
  await db.update(users)
    .set({ name: 'Jack', displayName: 'Jack' })
    .where(eq(users.name, 'Noah'));

  // Slett Olivia
  await db.delete(users).where(eq(users.name, 'Olivia'));

  // Sett kaller_meg = 'Lars' i uiPreference
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    UPDATE users
    SET ui_preference = jsonb_set(ui_preference, '{kaller_meg}', '"Lars"', true)
    WHERE name = 'Lars'
  `);
  app.log.info('MIGRATE_MEMBERS: kaller_meg satt til Lars');
  app.log.info('MIGRATE_MEMBERS: ferdig');
}

// ─── Engangs: kjør memory-jobb manuelt ───
if (process.env.RUN_MEMORY_JOB === 'true') {
  const { runMemoryJobNow } = await import('./memory/index.js');
  app.log.info('RUN_MEMORY_JOB: starter');
  await runMemoryJobNow(app.log);
  app.log.info('RUN_MEMORY_JOB: ferdig');
}

if (process.env.SEED_ON_STARTUP === 'true') {
  const { db, households, users, shoppingItems, tasks, ideas } = await import('@hallakompis/db');

  const existing = await db.select().from(households).limit(1);
  if (existing.length > 0) {
    app.log.info('Seed: Husstand finnes allerede, hopper over');
  } else {
    app.log.info('Seed: Oppretter familien Goberg');

    const [household] = await db.insert(households).values({ name: 'Familien Goberg' }).returning();
    if (!household) throw new Error('Klarte ikke opprette husstand');

    const [goberg] = await db.insert(users).values({
      householdId: household.id,
      name: 'Goberg',
      displayName: 'Goberg',
      role: 'adult',
      avatarColor: '#B8763D',
      uiPreference: { kaller_meg: 'Goberg', tone: 'nøytral', språk: 'nb-NO', bekreft_før_handling: true },
    }).returning();

    const [ida] = await db.insert(users).values({
      householdId: household.id, name: 'Ida', displayName: 'Ida', role: 'adult', avatarColor: '#7A8D7A',
    }).returning();

    await db.insert(users).values([
      { householdId: household.id, name: 'Emma', role: 'child', avatarColor: '#C45C48' },
      { householdId: household.id, name: 'Noah', role: 'child', avatarColor: '#6B4A6B' },
      { householdId: household.id, name: 'Olivia', role: 'child', avatarColor: '#DAA94E' },
    ]);

    if (!goberg) throw new Error('Klarte ikke opprette bruker');

    await db.insert(shoppingItems).values([
      { householdId: household.id, content: 'Melk — 2L', category: 'meieri', addedBy: goberg.id },
      { householdId: household.id, content: 'Smør', category: 'meieri', addedBy: ida?.id },
      { householdId: household.id, content: 'Bananer', category: 'frukt', addedBy: goberg.id },
      { householdId: household.id, content: 'Kaffe — Solberg & Hansen', category: 'annet', addedBy: goberg.id },
    ]);

    await db.insert(tasks).values([
      { userId: goberg.id, content: 'Godkjenne mix — Skarvik', priority: 'high', listType: 'today' },
      { userId: goberg.id, content: 'Signere kontrakt Nordvind', priority: 'high', listType: 'today' },
      { userId: goberg.id, content: 'Bestille studio-time uke 18', priority: 'medium', listType: 'later' },
    ]);

    await db.insert(ideas).values([
      { userId: goberg.id, tag: 'Lyddesign', content: 'Teste Atmos-objektspor for stemme i Nordvind-prosjektet' },
      { userId: goberg.id, tag: 'Familie', content: 'Telttur i Nordmarka før sommerferien' },
    ]);

    app.log.info(`Seed: Ferdig! Goberg ID: ${goberg.id}`);
  }
}

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

try {
  // Start nattlig memory-cron
  const { startMemoryCron } = await import('./memory/index.js');
  startMemoryCron(app.log);

  await app.listen({ port, host });
  app.log.info(`Kompis API er klar på http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
