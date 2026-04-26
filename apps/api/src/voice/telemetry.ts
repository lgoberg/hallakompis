/**
 * Logger fullførte tale-økter til voice_sessions for å måle latency
 * og utfall over tid.
 */
import type { FastifyInstance } from 'fastify';
import { db, voiceSessions } from '@hallakompis/db';
import { z } from 'zod';

const logRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  inputMode: z.enum(['web-speech', 'media-recorder', 'whisper-streaming', 'realtime']),
  outputMode: z.enum(['browser-tts', 'elevenlabs', 'realtime']),
  result: z.enum([
    'success',
    'cancelled',
    'no-speech',
    'stt-error',
    'llm-error',
    'tts-error',
    'permission-denied',
  ]),
  errorReason: z.string().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  sttLatencyMs: z.number().int().nonnegative().optional(),
  llmLatencyMs: z.number().int().nonnegative().optional(),
  ttsLatencyMs: z.number().int().nonnegative().optional(),
  totalLatencyMs: z.number().int().nonnegative().optional(),
  transcript: z.string().max(5000).optional(),
  responseText: z.string().max(10000).optional(),
});

export async function registerTelemetryRoute(app: FastifyInstance): Promise<void> {
  app.post('/sessions', async (request, reply) => {
    // Auth: brukeren må være innlogget
    const userId = (request as unknown as { userId?: string }).userId;
    if (!userId) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    const parsed = logRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid request', details: parsed.error.issues });
    }

    const data = parsed.data;
    try {
      await db.insert(voiceSessions).values({
        userId,
        conversationId: data.conversationId,
        inputMode: data.inputMode,
        outputMode: data.outputMode,
        result: data.result,
        errorReason: data.errorReason,
        startedAt: new Date(data.startedAt),
        endedAt: new Date(data.endedAt),
        sttLatencyMs: data.sttLatencyMs,
        llmLatencyMs: data.llmLatencyMs,
        ttsLatencyMs: data.ttsLatencyMs,
        totalLatencyMs: data.totalLatencyMs,
        transcript: data.transcript,
        responseText: data.responseText,
      });
      return { ok: true };
    } catch (err) {
      app.log.warn({ err }, '[voice/telemetry] insert feilet');
      return reply.status(500).send({ error: 'log-failed' });
    }
  });
}
