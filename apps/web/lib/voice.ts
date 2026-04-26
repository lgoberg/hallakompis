'use client';

/**
 * Voice fase 2.5 — frontend-hook for tale-input + auto-TTS + telemetri.
 *
 * Modus:
 *  - Hold (pointerdown → pointerup, > 200ms): én runde tale → chat → TTS
 *  - Toggle (dobbeltklikk): hands-free loop til neste dobbeltklikk
 *
 * STT: Web Speech API (browser-native, nb-NO).
 * TTS: POST /api/voice/tts → mp3-stream → Audio.play(). Hvis 501,
 *      faller vi tilbake til ingen avspilling (klient kan i framtid
 *      bruke speechSynthesis).
 * Telemetri: hver fullført runde POSTes til /api/voice/sessions
 *            (fire-and-forget, feil svelges).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ─── Web Speech API typer (ikke i TS lib.dom) ────────────────────────
interface SRAlternative { transcript: string; confidence: number }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SRResultList { length: number; [i: number]: SRResult }
interface SREvent extends Event { resultIndex: number; results: SRResultList }
interface SRErrorEvent extends Event { error: string; message?: string }
interface SR extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SRConstructor { new (): SR }
declare global {
  interface Window {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  }
}

export type VoiceState =
  | 'idle'
  | 'holding'
  | 'locked'
  | 'processing'
  | 'speaking'
  | 'unsupported'
  | 'error';

type VoiceResult =
  | 'success'
  | 'cancelled'
  | 'no-speech'
  | 'stt-error'
  | 'llm-error'
  | 'tts-error'
  | 'permission-denied';

type VoiceOutputMode = 'browser-tts' | 'elevenlabs' | 'realtime';

interface RoundData {
  startedAt: number;
  sttDoneAt?: number;
  llmDoneAt?: number;
  ttsDoneAt?: number;
  transcript?: string;
  reply?: string;
  outputMode: VoiceOutputMode;
  trigger: 'hold' | 'lock';
}

export interface UseVoiceOptions {
  /** Kalles når en ferdig ytring er klar. Returner svartekst som skal leses opp, eller null/undefined. */
  onUtterance: (transcript: string) => Promise<string | null | undefined>;
  language?: string;
  /** Minimum hold-tid før vi tolker det som press-to-talk (ms). */
  holdThresholdMs?: number;
}

export interface VoiceControls {
  state: VoiceState;
  interim: string;
  errorReason?: string;
  pressStart: () => void;
  pressEnd: () => void;
  toggle: () => void;
  cancel: () => void;
}

const TTS_FALLBACK_MARKER = 'tts-fallback';

export function useVoice({
  onUtterance,
  language = 'nb-NO',
  holdThresholdMs = 200,
}: UseVoiceOptions): VoiceControls {
  const [state, setState] = useState<VoiceState>('idle');
  const [interim, setInterim] = useState('');
  const [errorReason, setErrorReason] = useState<string | undefined>(undefined);

  const recognitionRef = useRef<SR | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const modeRef = useRef<'idle' | 'hold' | 'lock'>('idle');
  const pressedAtRef = useRef<number>(0);
  const finalTranscriptRef = useRef<string>('');
  const cancelRequestedRef = useRef<boolean>(false);
  const roundRef = useRef<RoundData | null>(null);

  // ─── Telemetri-helpers (kun ref-basert, stabile på tvers av renders) ─
  const startRound = useCallback((trigger: 'hold' | 'lock') => {
    roundRef.current = { startedAt: Date.now(), outputMode: 'elevenlabs', trigger };
  }, []);

  const finalizeRound = useCallback((result: VoiceResult, reason?: string) => {
    const r = roundRef.current;
    if (!r) return;
    roundRef.current = null;
    const endedAt = Date.now();
    const payload = {
      inputMode: 'web-speech' as const,
      outputMode: r.outputMode,
      result,
      errorReason: reason,
      startedAt: new Date(r.startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      sttLatencyMs: r.sttDoneAt ? r.sttDoneAt - r.startedAt : undefined,
      llmLatencyMs: r.llmDoneAt && r.sttDoneAt ? r.llmDoneAt - r.sttDoneAt : undefined,
      ttsLatencyMs: r.ttsDoneAt && r.llmDoneAt ? r.ttsDoneAt - r.llmDoneAt : undefined,
      totalLatencyMs: endedAt - r.startedAt,
      transcript: r.transcript?.slice(0, 5000),
      responseText: r.reply?.slice(0, 10000),
    };
    void fetch('/api/voice/sessions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, []);

  const discardRound = useCallback(() => {
    roundRef.current = null;
  }, []);

  // ─── Init: feature-detect + opprett recognition én gang ────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setState('unsupported');
      return;
    }
    const rec = new Ctor();
    rec.lang = language;
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (e: SREvent) => {
      let interimText = '';
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) finalText += txt;
        else interimText += txt;
      }
      if (finalText) finalTranscriptRef.current += finalText;
      setInterim(interimText || finalTranscriptRef.current);
    };

    rec.onerror = (e: SRErrorEvent) => {
      if (e.error === 'aborted') return;
      setErrorReason(e.error);
      setState('error');
      modeRef.current = 'idle';
      const result: VoiceResult =
        e.error === 'not-allowed' ? 'permission-denied' :
        e.error === 'no-speech' ? 'no-speech' :
        'stt-error';
      finalizeRound(result, e.error);
    };

    rec.onend = () => {
      // recognition stoppet; håndter i pressEnd / toggle
    };

    recognitionRef.current = rec;

    return () => {
      try { rec.abort(); } catch {}
      recognitionRef.current = null;
    };
  }, [language, finalizeRound]);

  // ─── Stopp lyd ───────────────────────────────────────────────────
  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      try { a.pause(); a.src = ''; } catch {}
      audioRef.current = null;
    }
  }, []);

  // ─── Spill TTS via /api/voice/tts ─────────────────────────────────
  const speak = useCallback(async (text: string): Promise<void> => {
    const res = await fetch('/api/voice/tts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const err = new Error(`tts ${res.status}`);
      (err as Error & { code?: string }).code = TTS_FALLBACK_MARKER;
      throw err;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    await new Promise<void>((resolve) => {
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      void audio.play().catch(() => resolve());
    });
    audioRef.current = null;
  }, []);

  // ─── Kjør én runde: send transcript, spill svar, evt. restart ─────
  const runRound = useCallback(async (transcript: string) => {
    const round = roundRef.current;
    if (!transcript.trim()) {
      modeRef.current = 'idle';
      setState('idle');
      setInterim('');
      finalizeRound('no-speech');
      return;
    }
    if (round) {
      round.sttDoneAt = Date.now();
      round.transcript = transcript;
    }
    cancelRequestedRef.current = false;
    setState('processing');
    setInterim('');
    let reply: string | null | undefined;
    try {
      reply = await onUtterance(transcript);
      if (round) round.llmDoneAt = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'chat-error';
      setErrorReason(msg);
      setState('error');
      modeRef.current = 'idle';
      finalizeRound('llm-error', msg);
      return;
    }
    if (cancelRequestedRef.current) {
      modeRef.current = 'idle';
      setState('idle');
      finalizeRound('cancelled');
      return;
    }
    if (round) round.reply = reply ?? undefined;
    let ttsErrorReason: string | undefined;
    if (reply) {
      setState('speaking');
      try {
        await speak(reply);
        if (round) round.ttsDoneAt = Date.now();
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.code === TTS_FALLBACK_MARKER) {
          ttsErrorReason = 'tts-not-configured';
        } else {
          ttsErrorReason = e.message ?? 'tts-error';
          console.warn('[voice] TTS feilet:', err);
        }
      }
    }
    if (cancelRequestedRef.current) {
      modeRef.current = 'idle';
      setState('idle');
      finalizeRound('cancelled');
      return;
    }
    if (ttsErrorReason) {
      finalizeRound('tts-error', ttsErrorReason);
    } else {
      finalizeRound('success');
    }
    if (modeRef.current === 'lock') {
      finalTranscriptRef.current = '';
      startRound('lock');
      try {
        recognitionRef.current?.start();
        setState('locked');
      } catch {
        setState('locked');
      }
    } else {
      setState('idle');
    }
  }, [onUtterance, speak, finalizeRound, startRound]);

  // ─── Press start (mousedown / touchstart) ─────────────────────────
  const pressStart = useCallback(() => {
    if (state === 'unsupported') return;
    const rec = recognitionRef.current;
    if (!rec) return;
    if (state === 'speaking') {
      cancelRequestedRef.current = true;
      stopAudio();
    }
    if (modeRef.current === 'lock') {
      try { rec.abort(); } catch {}
      modeRef.current = 'idle';
      finalizeRound('cancelled');
    }
    modeRef.current = 'hold';
    pressedAtRef.current = Date.now();
    finalTranscriptRef.current = '';
    setInterim('');
    setErrorReason(undefined);
    setState('holding');
    startRound('hold');
    try { rec.start(); } catch {
      try { rec.abort(); rec.start(); } catch {}
    }
  }, [state, stopAudio, startRound, finalizeRound]);

  // ─── Press end (mouseup / touchend / leave) ──────────────────────
  const pressEnd = useCallback(() => {
    if (modeRef.current !== 'hold') return;
    const duration = Date.now() - pressedAtRef.current;
    const rec = recognitionRef.current;
    modeRef.current = 'idle';
    if (duration < holdThresholdMs) {
      // for kort — antas å være start på dobbeltklikk; ikke logg
      try { rec?.abort(); } catch {}
      discardRound();
      setState('idle');
      setInterim('');
      finalTranscriptRef.current = '';
      return;
    }
    try { rec?.stop(); } catch {}
    setState('processing');
    setTimeout(() => {
      const text = (finalTranscriptRef.current || interim).trim();
      void runRound(text);
    }, 120);
  }, [holdThresholdMs, runRound, interim, discardRound]);

  // ─── Toggle (dblclick) ───────────────────────────────────────────
  const toggle = useCallback(() => {
    if (state === 'unsupported') return;
    const rec = recognitionRef.current;
    if (!rec) return;
    if (modeRef.current === 'lock') {
      cancelRequestedRef.current = true;
      modeRef.current = 'idle';
      try { rec.abort(); } catch {}
      stopAudio();
      finalizeRound('cancelled');
      setState('idle');
      setInterim('');
      return;
    }
    cancelRequestedRef.current = false;
    stopAudio();
    modeRef.current = 'lock';
    finalTranscriptRef.current = '';
    setInterim('');
    setErrorReason(undefined);
    setState('locked');
    rec.onend = () => {
      if (modeRef.current !== 'lock') return;
      const text = (finalTranscriptRef.current || interim).trim();
      if (!text) {
        // ingen tale — logg som no-speech og restart
        finalizeRound('no-speech');
        finalTranscriptRef.current = '';
        startRound('lock');
        try { rec.start(); } catch {}
        return;
      }
      void runRound(text);
    };
    startRound('lock');
    try { rec.start(); } catch {
      try { rec.abort(); rec.start(); } catch {}
    }
  }, [state, stopAudio, runRound, interim, startRound, finalizeRound]);

  // ─── Cancel (esc / blur) ─────────────────────────────────────────
  const cancel = useCallback(() => {
    cancelRequestedRef.current = true;
    modeRef.current = 'idle';
    try { recognitionRef.current?.abort(); } catch {}
    stopAudio();
    finalizeRound('cancelled');
    setState('idle');
    setInterim('');
  }, [stopAudio, finalizeRound]);

  // ─── Cleanup på unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      try { recognitionRef.current?.abort(); } catch {}
      stopAudio();
    };
  }, [stopAudio]);

  return useMemo(
    () => ({ state, interim, errorReason, pressStart, pressEnd, toggle, cancel }),
    [state, interim, errorReason, pressStart, pressEnd, toggle, cancel]
  );
}
