/**
* Seed: Oppretter familien Goberg som testdata.
 * Kjør: pnpm db:seed
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Last .env fra repo-roten
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });

import { db } from './index.js';
import { households, users, shoppingItems, tasks, ideas } from './schema/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('🌱 Seeder familien Goberg...');

  // Enable pgvector extension (første gang)
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  // Household
  const [household] = await db.insert(households).values({
    name: 'Familien Goberg',
  }).returning();

  if (!household) throw new Error('Klarte ikke opprette husstand');

  // Users
  const [goberg] = await db.insert(users).values({
    householdId: household.id,
    name: 'Goberg',
    displayName: 'Goberg',
    role: 'adult',
    avatarColor: '#B8763D',
    uiPreference: {
      kaller_meg: 'Goberg',
      tone: 'nøytral',
      språk: 'nb-NO',
      bekreft_før_handling: true,
    },
  }).returning();

  const [ida] = await db.insert(users).values({
    householdId: household.id,
    name: 'Ida',
    displayName: 'Ida',
    role: 'adult',
    avatarColor: '#7A8D7A',
  }).returning();

  await db.insert(users).values([
    { householdId: household.id, name: 'Emma', role: 'child', avatarColor: '#C45C48' },
    { householdId: household.id, name: 'Noah', role: 'child', avatarColor: '#6B4A6B' },
    { householdId: household.id, name: 'Olivia', role: 'child', avatarColor: '#DAA94E' },
  ]);

  if (!goberg) throw new Error('Klarte ikke opprette bruker');

  // Noen handleliste-varer
  await db.insert(shoppingItems).values([
    { householdId: household.id, content: 'Melk — 2L', category: 'meieri', addedBy: goberg.id },
    { householdId: household.id, content: 'Smør', category: 'meieri', addedBy: ida?.id },
    { householdId: household.id, content: 'Bananer', category: 'frukt', addedBy: goberg.id },
    { householdId: household.id, content: 'Kaffe — Solberg & Hansen', category: 'annet', addedBy: goberg.id },
  ]);

  // Noen oppgaver
  await db.insert(tasks).values([
    { userId: goberg.id, content: 'Godkjenne mix — Skarvik', priority: 'high', listType: 'today' },
    { userId: goberg.id, content: 'Signere kontrakt Nordvind', priority: 'high', listType: 'today' },
    { userId: goberg.id, content: 'Bestille studio-time uke 18', priority: 'medium', listType: 'later' },
  ]);

  // Noen ideer
  await db.insert(ideas).values([
    { userId: goberg.id, tag: 'Lyddesign', content: 'Teste Atmos-objektspor for stemme i Nordvind-prosjektet' },
    { userId: goberg.id, tag: 'Familie', content: 'Telttur i Nordmarka før sommerferien' },
  ]);

  console.log('✓ Ferdig!');
  console.log(`  Husstand: ${household.name}`);
  console.log(`  Goberg ID: ${goberg.id}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
