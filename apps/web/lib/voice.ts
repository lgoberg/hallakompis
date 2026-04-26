'use client';

/**
 * Voice fase 2.5 — frontend-hook for tale-input + auto-TTS.
 *
 * Modus:
 *  - Hold (pointerdown → pointerup, > 200ms): én runde tale → chat → TTS
 *  - Toggle (dobbeltklikk): hands-free loop til neste dobbeltklikk
 *
 * STT: Web Speech API (browser-native, nb-NO).
 * TTS: POST /api/voice/tts → mp3-stream → Audio.play(). Hvis 501,
 *      faller vi tilbake til ingen avspilling (klient kan i framtid
 *      bruke speechSynthesis).
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
      // 'no-speech', 'not-allowed', 'aborted' osv.
      if (e.error === 'aborted') return;
      setErrorReason(e.error);
      setState('error');
      modeRef.current = 'idle';
    };

    rec.onend = () => {
      // recognition stoppet; håndter i pressEnd / toggle
    };

    recognitionRef.current = rec;

    return () => {
      try { rec.abort(); } catch {}
      recognitionRef.current = null;
    };
  }, [language]);

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
      // 501 = ikke konfigurert → tagger feilen så caller kan ignorere
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
    if (!transcript.trim()) {
      // tom ytring i hold-modus → bare gå til idle
      modeRef.current = 'idle';
      setState('idle');
      setInterim('');
      return;
    }
    cancelRequestedRef.current = false;
    setState('processing');
    setInterim('');
    let reply: string | null | undefined;
    try {
      reply = await onUtterance(transcript);
    } catch (err) {
      setErrorReason(err instanceof Error ? err.message : 'chat-error');
      setState('error');
      modeRef.current = 'idle';
      return;
    }
    if (cancelRequestedRef.current) {
      modeRef.current = 'idle';
      setState('idle');
      return;
    }
    if (reply) {
      setState('speaking');
      try {
        await speak(reply);
      } catch (err) {
        if ((err as { code?: string }).code !== TTS_FALLBACK_MARKER) {
          // ekte feil — logg, men ikke blokker neste runde
          console.warn('[voice] TTS feilet:', err);
        }
      }
    }
    if (cancelRequestedRef.current) {
      modeRef.current = 'idle';
      setState('idle');
      return;
    }
    if (modeRef.current === 'lock') {
      // restart for neste ytring
      finalTranscriptRef.current = '';
      try {
        recognitionRef.current?.start();
        setState('locked');
      } catch {
        // start kastet hvis allerede startet — anta locked
        setState('locked');
      }
    } else {
      setState('idle');
    }
  }, [onUtterance, speak]);

  // ─── Press start (mousedown / touchstart) ─────────────────────────
  const pressStart = useCallback(() => {
    if (state === 'unsupported') return;
    const rec = recognitionRef.current;
    if (!rec) return;
    // hvis vi snakker, avbryt avspilling og avbryt aktiv runde
    if (state === 'speaking') {
      cancelRequestedRef.current = true;
      stopAudio();
    }
    if (modeRef.current === 'lock') {
      // forlat lock først
      try { rec.abort(); } catch {}
      modeRef.current = 'idle';
    }
    modeRef.current = 'hold';
    pressedAtRef.current = Date.now();
    finalTranscriptRef.current = '';
    setInterim('');
    setErrorReason(undefined);
    setState('holding');
    try { rec.start(); } catch {
      // hvis allerede startet, abort + retry
      try { rec.abort(); rec.start(); } catch {}
    }
  }, [state, stopAudio]);

  // ─── Press end (mouseup / touchend / leave) ──────────────────────
  const pressEnd = useCallback(() => {
    if (modeRef.current !== 'hold') return;
    const duration = Date.now() - pressedAtRef.current;
    const rec = recognitionRef.current;
    modeRef.current = 'idle';
    if (duration < holdThresholdMs) {
      // for kort — antas å være start på dobbeltklikk
      try { rec?.abort(); } catch {}
      setState('idle');
      setInterim('');
      finalTranscriptRef.current = '';
      return;
    }
    try { rec?.stop(); } catch {}
    // gi recognition et øyeblikk til å levere final result
    setState('processing');
    setTimeout(() => {
      const text = (finalTranscriptRef.current || interim).trim();
      void runRound(text);
    }, 120);
  }, [holdThresholdMs, runRound, interim]);

  // ─── Toggle (dblclick) ───────────────────────────────────────────
  const toggle = useCallback(() => {
    if (state === 'unsupported') return;
    const rec = recognitionRef.current;
    if (!rec) return;
    if (modeRef.current === 'lock') {
      // av
      cancelRequestedRef.current = true;
      modeRef.current = 'idle';
      try { rec.abort(); } catch {}
      stopAudio();
      setState('idle');
      setInterim('');
      return;
    }
    // på
    cancelRequestedRef.current = false;
    stopAudio();
    modeRef.current = 'lock';
    finalTranscriptRef.current = '';
    setInterim('');
    setErrorReason(undefined);
    setState('locked');
    // i lock binder vi onend til å trigge runde
    rec.onend = () => {
      if (modeRef.current !== 'lock') return;
      const text = (finalTranscriptRef.current || interim).trim();
      if (!text) {
        // ingen tale — restart
        try { rec.start(); } catch {}
        return;
      }
      void runRound(text);
    };
    try { rec.start(); } catch {
      try { rec.abort(); rec.start(); } catch {}
    }
  }, [state, stopAudio, runRound, interim]);

  // ─── Cancel (esc / blur) ─────────────────────────────────────────
  const cancel = useCallback(() => {
    cancelRequestedRef.current = true;
    modeRef.current = 'idle';
    try { recognitionRef.current?.abort(); } catch {}
    stopAudio();
    setState('idle');
    setInterim('');
  }, [stopAudio]);

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
