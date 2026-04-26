/**
 * Voice-relaterte tabeller. Telemetri for tale-økter.
 * Skiller fra index.ts for å holde modulene ryddige etter hvert.
 */
import { pgTable, uuid, text, timestamp, integer, pgEnum, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users, conversations } from './index';

export const voiceInputModeEnum = pgEnum('voice_input_mode', [
  'web-speech',          // browser native (fase 1)
  'media-recorder',      // fallback for Safari (fase 1)
  'whisper-streaming',   // fase 3
  'realtime',            // hvis vi noensinne bruker S2S
]);

export const voiceOutputModeEnum = pgEnum('voice_output_mode', [
  'browser-tts',         // fase 1
  'elevenlabs',          // fase 2
  'realtime',
]);

export const voiceSessionResultEnum = pgEnum('voice_session_result', [
  'success',
  'cancelled',
  'no-speech',
  'stt-error',
  'llm-error',
  'tts-error',
  'permission-denied',
]);

export const voiceSessions = pgTable('voice_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),

  // Hva ble brukt
  inputMode: voiceInputModeEnum('input_mode').notNull(),
  outputMode: voiceOutputModeEnum('output_mode').notNull(),

  // Hvordan endte det
  result: voiceSessionResultEnum('result').notNull(),
  errorReason: text('error_reason'),

  // Tidsstempler (alle UTC)
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),

  // Latency-mål (millisekunder)
  sttLatencyMs: integer('stt_latency_ms'),       // fra slutt-på-tale til transkript klart
  llmLatencyMs: integer('llm_latency_ms'),       // fra transkript inn til Claude-svar ut
  ttsLatencyMs: integer('tts_latency_ms'),       // fra svar inn til første audio-byte ut
  totalLatencyMs: integer('total_latency_ms'),   // hele rundturen

  // Innhold
  transcript: text('transcript'),                 // hva STT hørte (final)
  responseText: text('response_text'),            // hva Claude svarte
}, (t) => [
  index('idx_voice_sessions_user_time').on(t.userId, t.startedAt),
  index('idx_voice_sessions_result').on(t.result),
]);

export const voiceSessionsRelations = relations(voiceSessions, ({ one }) => ({
  user: one(users, { fields: [voiceSessions.userId], references: [users.id] }),
  conversation: one(conversations, { fields: [voiceSessions.conversationId], references: [conversations.id] }),
}));
