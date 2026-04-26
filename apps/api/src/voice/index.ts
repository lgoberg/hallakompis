import type { FastifyInstance } from 'fastify';
import { registerTtsRoute } from './tts.js';
import { registerSttRoute } from './stt.js';
import { registerTelemetryRoute } from './telemetry.js';

export async function registerVoiceRoutes(app: FastifyInstance): Promise<void> {
  await registerTtsRoute(app);
  await registerSttRoute(app);
  await registerTelemetryRoute(app);
}
