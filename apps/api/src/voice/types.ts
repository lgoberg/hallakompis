/**
 * Delte typer for voice-API. Klient og server bruker samme kontrakt.
 */

export type VoiceInputMode = 'web-speech' | 'media-recorder' | 'whisper-streaming' | 'realtime';
export type VoiceOutputMode = 'browser-tts' | 'elevenlabs' | 'realtime';

export type VoiceSessionResult =
  | 'success'
  | 'cancelled'
  | 'no-speech'
  | 'stt-error'
  | 'llm-error'
  | 'tts-error'
  | 'permission-denied';

/** Klient sender dette etter en fullført tale-økt for telemetri */
export interface VoiceSessionLogRequest {
  conversationId?: string;
  inputMode: VoiceInputMode;
  outputMode: VoiceOutputMode;
  result: VoiceSessionResult;
  errorReason?: string;
  startedAt: string;        // ISO-8601
  endedAt: string;
  sttLatencyMs?: number;
  llmLatencyMs?: number;
  ttsLatencyMs?: number;
  totalLatencyMs?: number;
  transcript?: string;
  responseText?: string;
}

/** TTS-proxy: tekst inn, audio ut */
export interface TtsRequest {
  text: string;
  voice?: string;            // brukes i fase 2 (ElevenLabs voice-ID)
}

/** STT-proxy: audio inn, tekst ut */
export interface SttResponse {
  transcript: string;
  language?: string;
  durationMs?: number;
}
