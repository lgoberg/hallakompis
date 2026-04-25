/**
 * Tynn wrapper rundt OpenAI embeddings-API.
 * Bruker fetch direkte – ingen SDK-avhengighet.
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small'; // 1536 dim

export async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY mangler');

  // Trim og kort ned absurd lange inputs (8k token limit)
  const input = text.slice(0, 30000);

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI embeddings feilet (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  if (!data.data?.[0]?.embedding) throw new Error('Tomt embedding-svar');
  return data.data[0].embedding;
}

/** Konverter embedding til pgvector-streng-format: '[0.1,0.2,...]' */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
