/**
 * Voice-rutemodulen som Fastify plugin.
 * Registreres med prefix '/voice' i server.ts.
 */
import type { FastifyInstance } from 'fastify';
import { registerTtsRoute } from './tts.js';
import { registerSttRoute } from './stt.js';
import { registerTelemetryRoute } from './telemetry.js';

export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  app.log.info("[voice] registerer ruter");
  await registerTtsRoute(app);
  await registerSttRoute(app);
  await registerTelemetryRoute(app);
}

