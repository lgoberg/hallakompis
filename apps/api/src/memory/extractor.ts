/**
 * Etter hver assistent-tur: les siste 4 meldinger, be Haiku ekstrahere
 * facts og events, skriv til DB med embeddings.
 * Kjøres asynkront — feiler stille.
 */
import { db, chatMessages, memoryFacts, memoryEvents } from '@hallakompis/db';
import { eq, desc } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { createEmbedding, toVectorLiteral } from '../lib/openai.js';
import { sql } from 'drizzle-orm';

const EXTRACTOR_MODEL = 'claude-haiku-4-5-20251001';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ExtractedFact {
  fact: string;
  category?: string;
  confidence?: number;
}

interface ExtractedEvent {
  type: 'decision' | 'outcome' | 'state' | 'event';
  content: string;
  structured?: Record<string, unknown>;
  confidence?: number;
}

interface ExtractionResult {
  facts: ExtractedFact[];
  events: ExtractedEvent[];
}

const SYSTEM = `Du er en minne-ekstraktor for et personlig AI-system. Du leser de siste meldingene mellom brukeren og assistenten, og henter ut to typer informasjon:

1. FAKTA — stabile påstander om brukeren: preferanser, relasjoner, rutiner, navn på personer/steder, ferdigheter, helse, jobb. Bare ting som er sannsynlig sant over tid.

2. HENDELSER — tidsstemplet observasjoner i fire kategorier:
   - decision: brukeren tok et valg ("skal bli hjemme i kveld")
   - outcome: hvordan noe gikk ("kjedet meg, burde dratt")
   - state: emosjonell/fysisk tilstand ("er sliten", "gleder meg")
   - event: konkret ting som skjedde ("var på Robert Plant-konsert")

Returner BARE gyldig JSON:
{
  "facts": [{"fact": "...", "category": "preference|relationship|routine|skill|health|work", "confidence": 0.0-1.0}],
  "events": [{"type": "decision|outcome|state|event", "content": "...", "structured": {}, "confidence": 0.0-1.0}]
}

Regler:
- Ikke gjett. Hvis ingenting verdt å huske, returner tomme arrays.
- Skriv content i tredje person ("Lars valgte...") for konsistens i søk.
- Ekstrahér KUN fra brukerens egne meldinger, ikke fra assistentens svar.
- For decisions: inkluder begrunnelse i structured ({reason: "..."}).
- Confidence under 0.5 = ikke ta med.
- Maks 5 facts og 5 events per ekstraksjon.`;

export async function extractMemory(userId: string, conversationId: string): Promise<void> {
  try {
    // Hent siste 4 meldinger fra denne samtalen
    const recent = await db
      .select({ role: chatMessages.role, content: chatMessages.content, createdAt: chatMessages.createdAt })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(4);

    if (recent.length === 0) return;

    // Format som ren tekst for Haiku
    const transcript = recent
      .reverse()
      .map((m) => {
        const text = extractTextFromContent(m.content);
        return `[${m.role}]: ${text}`;
      })
      .filter((s) => s.split(': ')[1]?.trim())
      .join('\n\n');

    if (!transcript.trim()) return;

    const response = await anthropic.messages.create({
      model: EXTRACTOR_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: transcript }],
    });

    const text = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    const parsed = parseJson(text);
    if (!parsed) {
      console.warn('[extractor] kunne ikke parse JSON:', text.slice(0, 200));
      return;
    }

    await Promise.all([writeFacts(userId, parsed.facts ?? []), writeEvents(userId, parsed.events ?? [])]);
  } catch (err) {
    console.warn('[extractor] feilet:', err);
  }
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === 'object' && 'type' in b && b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join(' ');
  }
  return '';
}

function parseJson(raw: string): ExtractionResult | null {
  // Strip eventuelle ```json wrappers
  const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();
  try {
    return JSON.parse(cleaned) as ExtractionResult;
  } catch {
    // Prøv å finne første { ... } blokk
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as ExtractionResult;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function writeFacts(userId: string, facts: ExtractedFact[]): Promise<void> {
  for (const f of facts) {
    if (!f.fact || (f.confidence ?? 0.7) < 0.5) continue;
    try {
      const emb = await createEmbedding(f.fact);
      await db.execute(sql`
        INSERT INTO memory_facts (user_id, fact, category, confidence, source_type, embedding)
        VALUES (${userId}, ${f.fact}, ${f.category ?? null}, ${f.confidence ?? 0.7}, 'implicit', ${toVectorLiteral(emb)}::vector)
      `);
    } catch (err) {
      console.warn('[extractor] write fact feilet:', err);
    }
  }
}

async function writeEvents(userId: string, events: ExtractedEvent[]): Promise<void> {
  for (const e of events) {
    if (!e.content || (e.confidence ?? 0.7) < 0.5) continue;
    try {
      const emb = await createEmbedding(e.content);
      await db.execute(sql`
        INSERT INTO memory_events (user_id, type, content, structured, embedding, occurred_at, confidence)
        VALUES (${userId}, ${e.type}, ${e.content}, ${JSON.stringify(e.structured ?? {})}::jsonb, ${toVectorLiteral(emb)}::vector, NOW(), ${e.confidence ?? 0.7})
      `);
    } catch (err) {
      console.warn('[extractor] write event feilet:', err);
    }
  }
}
