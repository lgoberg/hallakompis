/**
 * Reflector: finner klustre av linkede decision/outcome-par og 
 * genererer eller forsterker reflections.
 *
 * Kjøres etter linker. Idempotent – sjekker om eksisterende reflection
 * dekker mønsteret før den lager nytt.
 */
import { db, memoryReflections } from '@hallakompis/db';
import { sql, eq } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { createEmbedding, toVectorLiteral } from '../lib/openai.js';

const MIN_PAIRS_FOR_REFLECTION = 3;
const EXISTING_REFLECTION_SIMILARITY_THRESHOLD = 0.3;
const REFLECTOR_MODEL = 'claude-haiku-4-5-20251001';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `Du analyserer mønstre fra par av (decision, outcome) for én bruker. 
Et "par" er et valg brukeren tok og hvordan det gikk.

Du får 3+ par. Finn det generelle mønsteret som forbinder dem.

Returner BARE JSON:
{
  "pattern": "Én klar setning i tredje person, f.eks. 'Lars angrer ofte når han avlyser sosiale ting fordi han er sliten.'",
  "confidence": 0.0-1.0
}

Regler:
- Ikke gjett. Hvis parene er for ulike til å se mønster, returner {"pattern": "", "confidence": 0}.
- Confidence reflekterer hvor konsistent mønsteret er, ikke hvor sterkt det er emosjonelt.
- Pattern skal være handlingsrelevant – noe Kompis kan bringe opp neste gang lignende valg dukker opp.`;

export interface ReflectionResult {
  usersProcessed: number;
  reflectionsCreated: number;
  reflectionsReinforced: number;
  errors: number;
}

export async function runReflector(): Promise<ReflectionResult> {
  let usersProcessed = 0;
  let reflectionsCreated = 0;
  let reflectionsReinforced = 0;
  let errors = 0;

  // Finn brukere som har minst MIN_PAIRS_FOR_REFLECTION linkede par
  const usersWithPairs = await db.execute(sql`
    SELECT user_id, COUNT(*) AS n_pairs
    FROM memory_events
    WHERE type = 'outcome' AND reflects_on_event_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) >= ${MIN_PAIRS_FOR_REFLECTION}
  `);

  const userRows = (usersWithPairs as unknown as { rows?: Array<{ user_id: string }> }).rows
    ?? (usersWithPairs as unknown as Array<{ user_id: string }>);

  for (const u of userRows ?? []) {
    usersProcessed++;
    try {
      // Hent alle par for brukeren
      const pairs = await db.execute(sql`
        SELECT 
          d.content AS decision,
          o.content AS outcome,
          d.occurred_at AS decision_at,
          o.occurred_at AS outcome_at,
          o.id AS outcome_id,
          d.id AS decision_id
        FROM memory_events o
        JOIN memory_events d ON d.id = o.reflects_on_event_id
        WHERE o.user_id = ${u.user_id}
          AND o.type = 'outcome'
          AND o.superseded_by IS NULL
        ORDER BY o.occurred_at DESC
        LIMIT 30
      `);

      const pairRows = (pairs as unknown as { rows?: Array<Record<string, unknown>> }).rows
        ?? (pairs as unknown as Array<Record<string, unknown>>);

      if (!pairRows || pairRows.length < MIN_PAIRS_FOR_REFLECTION) continue;

      // Format som JSON for modellen
      const pairsText = pairRows
        .map((p, i) => `Par ${i + 1}:\n  Decision: ${p.decision}\n  Outcome: ${p.outcome}`)
        .join('\n\n');

      const response = await anthropic.messages.create({
        model: REFLECTOR_MODEL,
        max_tokens: 512,
        system: SYSTEM,
        messages: [{ role: 'user', content: pairsText }],
      });

      const text = response.content
        .filter((c): c is Anthropic.TextBlock => c.type === 'text')
        .map((c) => c.text)
        .join('\n');

      const parsed = parsePattern(text);
      if (!parsed || !parsed.pattern || (parsed.confidence ?? 0) < 0.5) continue;

      // Embed pattern for similarity-sjekk mot eksisterende
      const patternEmbedding = await createEmbedding(parsed.pattern);
      const patternVec = toVectorLiteral(patternEmbedding);

      // Finnes lignende reflection?
      const existing = await db.execute(sql`
        SELECT id, embedding <=> ${patternVec}::vector AS distance
        FROM memory_reflections
        WHERE user_id = ${u.user_id} AND active = true AND embedding IS NOT NULL
        ORDER BY embedding <=> ${patternVec}::vector
        LIMIT 1
      `);

      const existingRows = (existing as unknown as { rows?: Array<{ id: string; distance: number }> }).rows
        ?? (existing as unknown as Array<{ id: string; distance: number }>);

      const evidenceIds = pairRows.map((p) => ({ outcome: p.outcome_id, decision: p.decision_id }));

      if (existingRows?.[0] && Number(existingRows[0].distance) < EXISTING_REFLECTION_SIMILARITY_THRESHOLD) {
        // Forsterk eksisterende
        await db
          .update(memoryReflections)
          .set({
            confidence: Math.min(1.0, parsed.confidence ?? 0.6),
            lastReinforcedAt: new Date(),
            evidence: evidenceIds,
          })
          .where(eq(memoryReflections.id, existingRows[0].id));
        reflectionsReinforced++;
      } else {
        // Ny reflection
        await db.execute(sql`
          INSERT INTO memory_reflections (user_id, pattern, evidence, confidence, embedding)
          VALUES (
            ${u.user_id},
            ${parsed.pattern},
            ${JSON.stringify(evidenceIds)}::jsonb,
            ${parsed.confidence ?? 0.6},
            ${patternVec}::vector
          )
        `);
        reflectionsCreated++;
      }
    } catch (err) {
      errors++;
      console.warn('[reflector] error på user', u.user_id, err);
    }
  }

  return { usersProcessed, reflectionsCreated, reflectionsReinforced, errors };
}

function parsePattern(raw: string): { pattern: string; confidence: number } | null {
  const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
