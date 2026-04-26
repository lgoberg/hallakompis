/**
 * STT-proxy. Tar audio, returnerer tekst.
 *
 * Fase 1: mock — returnerer 501. Klient bruker Web Speech API i stedet.
 * Fase 3: OpenAI Whisper streaming via multipart upload eller WebSocket.
 */
import type { FastifyInstance } from 'fastify';

export async function registerSttRoute(app: FastifyInstance): Promise<void> {
  app.post('/voice/stt', async (_request, reply) => {
    return reply.status(501).send({
      error: 'not-implemented',
      message: 'STT-proxy aktiveres i fase 3 (Whisper). Bruk Web Speech API.',
      fallback: 'web-speech',
    });
  });
}
