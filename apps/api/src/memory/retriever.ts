/**
 * Gitt en bruker-melding, finn relevante minner og format som tekst-blokk
 * for system prompt.
 */
import { db, memoryFacts, memoryEvents, memoryReflections } from '@hallakompis/db';
import { eq, desc, sql, and } from 'drizzle-orm';
import { createEmbedding, toVectorLiteral } from '../lib/openai.js';

const TOP_K_FACTS = 8;
const TOP_K_EVENTS = 6;

export async function retrieveMemory(userId: string, userMessage: string): Promise<string> {
  let queryEmbedding: string;
  try {
    const vec = await createEmbedding(userMessage);
    queryEmbedding = toVectorLiteral(vec);
  } catch (err) {
    console.warn('[memory] embedding feilet, hopper over retrieval:', err);
    return '';
  }

  const [facts, events, reflections] = await Promise.all([
    // Topp K facts ved cosine similarity
    db.execute(sql`
      SELECT fact, category, confidence
      FROM memory_facts
      WHERE user_id = ${userId} AND embedding IS NOT NULL
      ORDER BY embedding <=> ${queryEmbedding}::vector
      LIMIT ${TOP_K_FACTS}
    `),

    // Topp K events ved similarity, men boost recency
    db.execute(sql`
      SELECT type, content, structured, occurred_at, confidence
      FROM memory_events
      WHERE user_id = ${userId} AND embedding IS NOT NULL AND superseded_by IS NULL
      ORDER BY embedding <=> ${queryEmbedding}::vector
      LIMIT ${TOP_K_EVENTS}
    `),

    // Alle aktive reflections (få av dem totalt)
    db
      .select({ pattern: memoryReflections.pattern, confidence: memoryReflections.confidence })
      .from(memoryReflections)
      .where(and(eq(memoryReflections.userId, userId), eq(memoryReflections.active, true)))
      .orderBy(desc(memoryReflections.confidence))
      .limit(10),
  ]);

  const factRows = (facts as unknown as { rows: Array<{ fact: string; category: string | null; confidence: number }> }).rows
    ?? (facts as unknown as Array<{ fact: string; category: string | null; confidence: number }>);
  const eventRows = (events as unknown as { rows: Array<{ type: string; content: string; occurred_at: Date; confidence: number }> }).rows
    ?? (events as unknown as Array<{ type: string; content: string; occurred_at: Date; confidence: number }>);

  const parts: string[] = [];

  if (reflections.length) {
    parts.push('## Mønstre jeg har lagt merke til');
    for (const r of reflections) parts.push(`- ${r.pattern}`);
  }

  if (factRows?.length) {
    parts.push('\n## Fakta om deg');
    for (const f of factRows) parts.push(`- ${f.fact}${f.category ? ` (${f.category})` : ''}`);
  }

  if (eventRows?.length) {
    parts.push('\n## Tidligere relevante hendelser');
    for (const e of eventRows) {
      const when = new Date(e.occurred_at).toLocaleDateString('nb-NO', { year: 'numeric', month: 'short', day: 'numeric' });
      parts.push(`- [${e.type}, ${when}] ${e.content}`);
    }
  }

  return parts.join('\n');
}
