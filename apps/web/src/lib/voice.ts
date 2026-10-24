/**
 * Beacon voice layer — Cartesia first, browser speech as the safety net.
 *
 * TTS: Cartesia Sonic over WebSocket, streamed PCM f32 @ 24 kHz into an
 *      AudioContext so the first syllable plays ~150 ms after the coach replies.
 *      Interruptible: calling speak() again cancels the in-flight utterance
 *      (barge-in), which matters when the camera interjects mid-sentence.
 * STT: Cartesia Ink over WebSocket, 16 kHz PCM s16le from an AudioWorklet,
 *      with `finalize` sent on a client-side VAD silence edge so we get a
 *      final transcript ~400 ms after the user stops talking.
 *
 * If Cartesia is unavailable (no key, token mint fails, socket drops) we fall
 * back to SpeechSynthesis / webkitSpeechRecognition so the product still talks.
 */

export const CARTESIA_VERSION = '2026-08-14';

export interface VoiceCreds {
  token: string;
  expiresAt: number;
  voiceId: string | null;
  ttsModel: string;
  sttModel: string;
}

export type VoiceStatus = 'idle' | 'speaking' | 'listening' | 'thinking' | 'offline';

export interface VoiceEvents {
  onStatus?: (s: VoiceStatus) => void;
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onProvider?: (p: 'cartesia' | 'browser') => void;
  onError?: (e: string) => void;
}

const DEFAULT_VOICE = 'a0e99841-438c-4a64-b679-ae501e7d6091'; // Cartesia "Barbershop Man" — calm, clear. Override via env.

export class VoiceEngine {
  private audioCtx: AudioContext | null = null;
  private ttsWs: WebSocket | null = null;
  private sttWs: WebSocket | null = null;
  private micStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private playhead = 0;
  private ttsContextId = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private speakingResolve: (() => void) | null = null;
  private browserRec: SpeechRecognition | null = null;
  private muted = false;
  private finalBuffer = '';
  private silenceTimer: number | null = null;
  private lastVoiceAt = 0;
  provider: 'cartesia' | 'browser' = 'browser';

  constructor(private getCreds: () => Promise<VoiceCreds | null>, private ev: VoiceEvents = {}) {}

  async init(): Promise<void> {
    this.audioCtx = this.audioCtx ?? new AudioContext({ sampleRate: 24000 });
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    const creds = await this.getCreds();
    this.provider = creds ? 'cartesia' : 'browser';
    this.ev.onProvider?.(this.provider);
  }

  setMuted(m: boolean) {
    this.muted = m;
  }

  // ───────────────────────────── TTS ─────────────────────────────

  async speak(text: string): Promise<void> {
    if (!text.trim()) return;
    this.stopSpeaking();
    this.ev.onStatus?.('speaking');
    try {
      if (this.provider === 'cartesia') {
        await this.speakCartesia(text);
      } else {
        await this.speakBrowser(text);
      }
    } catch (e) {
      this.ev.onError?.(`tts: ${(e as Error).message}`);
      if (this.provider === 'cartesia') {
        this.provider = 'browser';
        this.ev.onProvider?.('browser');
        await this.speakBrowser(text).catch(() => {});
      }
    } finally {
      this.ev.onStatus?.(this.sttWs || this.browserRec ? 'listening' : 'idle');
    }
  }

  stopSpeaking() {
    for (const s of this.activeSources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.activeSources = [];
    this.playhead = this.audioCtx?.currentTime ?? 0;
    this.ttsContextId++;
    if (this.ttsWs && this.ttsWs.readyState === WebSocket.OPEN) {
      // Cancel server-side generation for the old context.
      try {
        this.ttsWs.send(JSON.stringify({ context_id: `ctx-${this.ttsContextId - 1}`, cancel: true }));
      } catch {
        /* ignore */
      }
    }
    speechSynthesis?.cancel?.();
    this.speakingResolve?.();
    this.speakingResolve = null;
  }

  private async ensureTtsSocket(): Promise<WebSocket> {
    if (this.ttsWs && this.ttsWs.readyState === WebSocket.OPEN) return this.ttsWs;
    const creds = await this.getCreds();
    if (!creds) throw new Error('no cartesia credentials');
    const url = new URL('wss://api.cartesia.ai/tts/websocket');
    url.searchParams.set('cartesia_version', CARTESIA_VERSION);
    url.searchParams.set('access_token', creds.token);
    const ws = new WebSocket(url.toString());
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error('tts socket failed'));
      setTimeout(() => rej(new Error('tts socket timeout')), 5000);
    });
    ws.onclose = () => {
      if (this.ttsWs === ws) this.ttsWs = null;
    };
    this.ttsWs = ws;
    return ws;
  }

  private async speakCartesia(text: string): Promise<void> {
    const ws = await this.ensureTtsSocket();
    const creds = (await this.getCreds())!;
    const ctxId = `ctx-${this.ttsContextId}`;
    const ac = this.audioCtx!;
    this.playhead = Math.max(this.playhead, ac.currentTime + 0.05);

    return new Promise<void>((resolve) => {
      this.speakingResolve = resolve;
      let lastEnd = this.playhead;
      const onMsg = (ev: MessageEvent) => {
        let msg: { type: string; context_id?: string; data?: string; done?: boolean; error?: string };
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (msg.context_id && msg.context_id !== ctxId) return;
        if (msg.type === 'chunk' && msg.data) {
          const f32 = base64ToF32(msg.data);
          const buf = ac.createBuffer(1, f32.length, 24000);
          buf.copyToChannel(f32, 0);
          const src = ac.createBufferSource();
          src.buffer = buf;
          src.connect(ac.destination);
          const startAt = Math.max(lastEnd, ac.currentTime);
          src.start(startAt);
          lastEnd = startAt + buf.duration;
          this.playhead = lastEnd;
          this.activeSources.push(src);
        } else if (msg.type === 'done' || msg.done) {
          ws.removeEventListener('message', onMsg);
          const wait = Math.max(0, (lastEnd - ac.currentTime) * 1000);
          setTimeout(() => {
            if (this.speakingResolve === resolve) this.speakingResolve = null;
            resolve();
          }, wait);
        } else if (msg.type === 'error') {
          ws.removeEventListener('message', onMsg);
          this.ev.onError?.(`cartesia tts: ${msg.error}`);
          resolve();
        }
      };
      ws.addEventListener('message', onMsg);
      ws.send(
        JSON.stringify({
          model_id: creds.ttsModel,
          transcript: text,
          voice: { mode: 'id', id: creds.voiceId ?? DEFAULT_VOICE },
          output_format: { container: 'raw', encoding: 'pcm_f32le', sample_rate: 24000 },
          language: 'en',
          context_id: ctxId,
          continue: false,
          // Emergency register: slightly slower and very clear.
          generation_config: { speed: 0.95 },
        }),
      );
    });
  }

  private speakBrowser(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.pitch = 1;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
      this.speakingResolve = resolve;
    });
  }

  // ───────────────────────────── STT ─────────────────────────────

  async startListening(): Promise<void> {
    if (this.sttWs || this.browserRec) return;
    try {
      if (this.provider === 'cartesia') await this.startCartesiaStt();
      else this.startBrowserStt();
    } catch (e) {
      this.ev.onError?.(`stt: ${(e as Error).message}`);
      this.provider = 'browser';
      this.ev.onProvider?.('browser');
      this.startBrowserStt();
    }
    this.ev.onStatus?.('listening');
  }

  stopListening() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    try {
      this.sttWs?.send('close');
    } catch {
      /* ignore */
    }
    this.sttWs?.close();
    this.sttWs = null;
    this.workletNode?.disconnect();
    this.workletNode = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.browserRec?.stop();
    this.browserRec = null;
    this.ev.onStatus?.('idle');
  }

  private async startCartesiaStt(): Promise<void> {
    const creds = await this.getCreds();
    if (!creds) throw new Error('no cartesia credentials');
    const url = new URL('wss://api.cartesia.ai/stt/websocket');
    url.searchParams.set('model', creds.sttModel);
    url.searchParams.set('encoding', 'pcm_s16le');
    url.searchParams.set('sample_rate', '16000');
    url.searchParams.set('language', 'en');
    url.searchParams.set('cartesia_version', CARTESIA_VERSION);
    url.searchParams.set('access_token', creds.token);
    if (creds.sttModel === 'ink-whisper') {
      url.searchParams.set('min_volume', '0.12');
      url.searchParams.set('max_silence_duration_secs', '0.8');
    }
    const ws = new WebSocket(url.toString());
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error('stt socket failed'));
      setTimeout(() => rej(new Error('stt socket timeout')), 5000);
    });
    this.sttWs = ws;
    this.finalBuffer = '';

    ws.onmessage = (ev) => {
      let msg: { type: string; text?: string; is_final?: boolean; message?: string };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === 'transcript') {
        if (msg.is_final) {
          this.finalBuffer += msg.text ?? '';
          this.ev.onPartial?.(this.finalBuffer);
          this.scheduleUtteranceEnd();
        } else {
          this.ev.onPartial?.(this.finalBuffer + (msg.text ?? ''));
        }
      } else if (msg.type === 'flush_done') {
        this.emitFinal();
      } else if (msg.type === 'error') {
        this.ev.onError?.(`cartesia stt: ${msg.message}`);
      }
    };
    ws.onclose = () => {
      if (this.sttWs === ws) {
        this.sttWs = null;
        // Auto-reconnect while the incident is live.
        setTimeout(() => this.startListening().catch(() => {}), 800);
      }
    };

    // Microphone → AudioWorklet (16k s16le) → socket, with a tiny energy VAD.
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const micCtx = new AudioContext({ sampleRate: 16000 });
    await micCtx.audioWorklet.addModule(workletUrl());
    const src = micCtx.createMediaStreamSource(this.micStream);
    const node = new AudioWorkletNode(micCtx, 'pcm16-capture');
    node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (this.muted) return;
      // Half-duplex: don't feed our own TTS back in (echo cancel helps, this seals it).
      if (this.activeSources.length && this.playhead > (this.audioCtx?.currentTime ?? 0)) return;
      ws.send(e.data.pcm);
      if (e.data.rms > 0.015) {
        this.lastVoiceAt = performance.now();
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else if (this.lastVoiceAt && performance.now() - this.lastVoiceAt > 700 && !this.silenceTimer) {
        this.scheduleUtteranceEnd(0);
      }
    };
    src.connect(node);
    this.workletNode = node;
  }

  private scheduleUtteranceEnd(delay = 400) {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = window.setTimeout(() => {
      this.silenceTimer = null;
      try {
        this.sttWs?.send('finalize');
      } catch {
        this.emitFinal();
      }
    }, delay);
  }

  private emitFinal() {
    const text = this.finalBuffer.trim();
    this.finalBuffer = '';
    this.lastVoiceAt = 0;
    if (text.length >= 2) this.ev.onFinal?.(text);
  }

  private startBrowserStt() {
    const Rec = (window as unknown as { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
    if (!Rec) {
      this.ev.onError?.('No speech recognition available in this browser');
      return;
    }
    const rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.ev.onFinal?.(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      if (interim) this.ev.onPartial?.(interim);
    };
    rec.onend = () => {
      if (this.browserRec === rec) {
        try {
          rec.start();
        } catch {
          /* ignore */
        }
      }
    };
    rec.onerror = (e: Event & { error?: string }) => {
      if (e.error === 'not-allowed') this.ev.onError?.('Microphone permission denied');
    };
    rec.start();
    this.browserRec = rec;
  }

  destroy() {
    this.stopSpeaking();
    this.stopListening();
    this.ttsWs?.close();
    this.ttsWs = null;
  }
}

function base64ToF32(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length - (bin.length % 4));
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(buf);
}

let _workletUrl: string | null = null;
function workletUrl(): string {
  if (_workletUrl) return _workletUrl;
  const src = `
    class Pcm16Capture extends AudioWorkletProcessor {
      constructor(){ super(); this.buf = []; this.len = 0; }
      process(inputs){
        const ch = inputs[0] && inputs[0][0]; if(!ch) return true;
        this.buf.push(new Float32Array(ch)); this.len += ch.length;
        if (this.len >= 1600) { // 100 ms @ 16 kHz
          const out = new Int16Array(this.len); let o = 0, sum = 0;
          for (const b of this.buf) for (let i=0;i<b.length;i++){ const s = Math.max(-1, Math.min(1, b[i])); out[o++] = s*32767; sum += s*s; }
          const rms = Math.sqrt(sum/this.len);
          this.port.postMessage({ pcm: out.buffer, rms }, [out.buffer]);
          this.buf = []; this.len = 0;
        }
        return true;
      }
    }
    registerProcessor('pcm16-capture', Pcm16Capture);
  `;
  _workletUrl = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
  return _workletUrl;
}

// Minimal ambient typings for the Web Speech API fallback.
declare global {
  interface SpeechRecognitionEvent extends Event {
    resultIndex: number;
    results: SpeechRecognitionResultList;
  }
  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    onresult: ((e: SpeechRecognitionEvent) => void) | null;
    onend: (() => void) | null;
    onerror: ((e: Event & { error?: string }) => void) | null;
  }
  // eslint-disable-next-line no-var
  var SpeechRecognition: { new (): SpeechRecognition };
}
