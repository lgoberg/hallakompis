/**
 * Linker: finner outcome-events som peker bakover på decision-events.
 * Konservativ: cosine < 0.35, temporalt vindu 14 dager.
 *
 * Kjøres nattlig. Idempotent – ignorerer outcomes som allerede er linket.
 */
import { db } from '@hallakompis/db';
import { sql } from 'drizzle-orm';

const SIMILARITY_THRESHOLD = 0.35; // cosine distance, lavere = likere
const TEMPORAL_WINDOW_DAYS = 14;

export interface LinkResult {
  outcomesScanned: number;
  linksCreated: number;
  errors: number;
}

export async function runLinker(): Promise<LinkResult> {
  let outcomesScanned = 0;
  let linksCreated = 0;
  let errors = 0;

  // Finn alle outcomes som ennå ikke er linket
  const candidates = await db.execute(sql`
    SELECT id, user_id, content, embedding, occurred_at
    FROM memory_events
    WHERE type = 'outcome'
      AND reflects_on_event_id IS NULL
      AND superseded_by IS NULL
      AND embedding IS NOT NULL
  `);

  const rows = (candidates as unknown as { rows?: Array<{ id: string; user_id: string; embedding: string; occurred_at: Date }> }).rows
    ?? (candidates as unknown as Array<{ id: string; user_id: string; embedding: string; occurred_at: Date }>);

  for (const outcome of rows ?? []) {
    outcomesScanned++;
    try {
      // Finn nærmeste decision innen vinduet, samme bruker, før denne outcome
      const matches = await db.execute(sql`
        SELECT 
          id,
          embedding <=> ${outcome.embedding}::vector AS distance
        FROM memory_events
        WHERE user_id = ${outcome.user_id}
          AND type = 'decision'
          AND superseded_by IS NULL
          AND embedding IS NOT NULL
          AND occurred_at < ${outcome.occurred_at}
          AND occurred_at >= ${outcome.occurred_at}::timestamptz - INTERVAL '${sql.raw(String(TEMPORAL_WINDOW_DAYS))} days'
        ORDER BY embedding <=> ${outcome.embedding}::vector
        LIMIT 1
      `);

      const matchRows = (matches as unknown as { rows?: Array<{ id: string; distance: number }> }).rows
        ?? (matches as unknown as Array<{ id: string; distance: number }>);

      const best = matchRows?.[0];
      if (!best || Number(best.distance) > SIMILARITY_THRESHOLD) continue;

      // Link outcome → decision
      await db.execute(sql`
        UPDATE memory_events
        SET reflects_on_event_id = ${best.id}
        WHERE id = ${outcome.id}
      `);
      linksCreated++;
    } catch (err) {
      errors++;
      console.warn('[linker] error på outcome', outcome.id, err);
    }
  }

  return { outcomesScanned, linksCreated, errors };
}
