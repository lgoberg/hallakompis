/**
 * TTS-proxy. Tar tekst, returnerer audio.
 *
 * Fase 1: mock — returnerer 501 Not Implemented. Klient bruker browserens
 *         innebygde speechSynthesis i stedet.
 * Fase 2: ElevenLabs Multilingual v2.5 Turbo, streaming MP3.
 * Fase 3: streaming via WebSocket for parallell generering.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const ttsRequestSchema = z.object({
  text: z.string().min(1).max(5000),
  voice: z.string().optional(),
});

export async function registerTtsRoute(app: FastifyInstance): Promise<void> {
  app.post('/tts', async (request, reply) => {
    const parsed = ttsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid request', details: parsed.error.issues });
    }

    // Fase 1: mock. Fortell klienten å bruke innebygd TTS.
    return reply.status(501).send({
      error: 'not-implemented',
      message: 'TTS-proxy aktiveres i fase 2 (ElevenLabs). Bruk browser speechSynthesis.',
      fallback: 'browser-tts',
    });
  });
}
