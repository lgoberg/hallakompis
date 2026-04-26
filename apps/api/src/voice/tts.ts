/**
 * TTS-proxy. Tar tekst, returnerer audio.
 *
 * Fase 2: ElevenLabs Multilingual v2.5 Turbo, streaming MP3.
 *         Hvis ELEVENLABS_API_KEY eller ELEVENLABS_VOICE_ID mangler,
 *         returneres 501 så klienten faller tilbake til browser-TTS.
 * Fase 3: streaming via WebSocket for parallell generering.
 */
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { z } from 'zod';

const ttsRequestSchema = z.object({
  text: z.string().min(1).max(5000),
  voice: z.string().optional(),
});

const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5';

export async function registerTtsRoute(app: FastifyInstance): Promise<void> {
  app.post('/tts', async (request, reply) => {
    const parsed = ttsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid request', details: parsed.error.issues });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID;
    const modelId = process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID;
    const voiceId = parsed.data.voice ?? defaultVoiceId;

    if (!apiKey || !voiceId) {
      return reply.status(501).send({
        error: 'not-configured',
        message:
          'ElevenLabs ikke konfigurert (mangler ELEVENLABS_API_KEY eller ELEVENLABS_VOICE_ID). Bruk browser speechSynthesis.',
        fallback: 'browser-tts',
      });
    }

    const startedAt = Date.now();
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`;

    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: parsed.data.text,
          model_id: modelId,
          output_format: 'mp3_44100_128',
        }),
      });
    } catch (err) {
      app.log.error({ err }, '[voice/tts] ElevenLabs fetch feilet');
      return reply.status(502).send({ error: 'tts-upstream-unreachable' });
    }

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      app.log.warn(
        { status: upstream.status, detail: detail.slice(0, 500) },
        '[voice/tts] ElevenLabs returnerte feil'
      );
      return reply.status(502).send({
        error: 'tts-upstream-error',
        upstreamStatus: upstream.status,
      });
    }

    reply.header('Content-Type', 'audio/mpeg');
    reply.header('Cache-Control', 'no-store');

    const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    nodeStream.on('end', () => {
      app.log.info(
        { latencyMs: Date.now() - startedAt, voiceId, modelId, chars: parsed.data.text.length },
        '[voice/tts] ElevenLabs ferdig'
      );
    });
    nodeStream.on('error', (err) => {
      app.log.warn({ err }, '[voice/tts] stream-feil');
    });

    return reply.send(nodeStream);
  });
}
