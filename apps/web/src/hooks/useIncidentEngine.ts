import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { getProtocol, isProtocolId, type ArHint } from '@beacon/protocols';
import { captureJpegBase64, motionScore, openCamera } from '../lib/camera';
import { describeLocation, watchPosition, type Geo } from '../lib/geo';
import { getSessionId } from '../lib/session';
import { VoiceEngine, type VoiceCreds, type VoiceStatus } from '../lib/voice';
import type { OverlayScene } from '../components/AROverlay';

export type Phase = 'idle' | 'scanning' | 'incident' | 'resolved';

const SCAN_INTERVAL_MS = 2500;
const INCIDENT_INTERVAL_MS = 6000;
const MIN_MOTION_TO_UPLOAD = 0.012; // skip near-identical frames while scanning

export function useIncidentEngine() {
  const sessionId = useMemo(getSessionId, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [incidentId, setIncidentId] = useState<Id<'incidents'> | null>(null);
  const [scene, setScene] = useState<OverlayScene | null>(null);
  const [lastSummary, setLastSummary] = useState<string>('');
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [voiceProvider, setVoiceProvider] = useState<'cartesia' | 'browser'>('browser');
  const [partial, setPartial] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const geoRef = useRef<Geo | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);

  const analyzeFrame = useAction(api.triage.analyzeFrame);
  const respond = useAction(api.coach.respond);
  const nudge = useAction(api.coach.nudge);
  const cartesiaToken = useAction(api.voice.cartesiaToken);
  const markCalled = useMutation(api.incidents.markCalled);
  const openManual = useMutation(api.incidents.openManual);
  const resolveIncident = useMutation(api.incidents.resolve);
  const updateLocation = useMutation(api.incidents.updateLocation);

  const incident = useQuery(api.incidents.get, incidentId ? { incidentId } : 'skip');
  const messages = useQuery(api.incidents.messages, incidentId ? { incidentId } : 'skip');
  const alerts = useQuery(api.incidents.alerts, incidentId ? { incidentId } : 'skip');
  const helpers = useQuery(api.incidents.helperResponses, incidentId ? { incidentId } : 'skip');
  const resources = useQuery(api.incidents.resources, incidentId ? { incidentId } : 'skip');
  const afterAction = useQuery(api.incidents.afterAction, incidentId ? { incidentId } : 'skip');

  // ── Voice engine (one per mount) ─────────────────────────────────────────
  const credsRef = useRef<VoiceCreds | null>(null);
  const voiceRef = useRef<VoiceEngine | null>(null);
  const pushError = useCallback((e: string) => setErrors((prev) => [...prev.slice(-4), e]), []);
  const getCreds = useCallback(async (): Promise<VoiceCreds | null> => {
    if (credsRef.current && credsRef.current.expiresAt - Date.now() > 30_000) return credsRef.current;
    try {
      const r = await cartesiaToken({ sessionId });
      if (!r.ok) return null;
      credsRef.current = { token: r.token, expiresAt: Date.now() + r.expiresInSec * 1000, voiceId: r.voiceId, ttsModel: r.ttsModel, sttModel: r.sttModel };
      return credsRef.current;
    } catch {
      return null;
    }
  }, [cartesiaToken, sessionId]);

  const incidentIdRef = useRef<Id<'incidents'> | null>(null);
  incidentIdRef.current = incidentId;
  const lastUserSpeechAt = useRef(0);

  const onFinal = useCallback(
    async (text: string) => {
      setPartial('');
      lastUserSpeechAt.current = Date.now();
      const id = incidentIdRef.current;
      if (!id) return;
      setVoiceStatus('thinking');
      voiceRef.current?.stopSpeaking();
      await respond({ incidentId: id, utterance: text, sessionId }).catch((e) => pushError(`coach: ${e.message}`));
    },
    [respond, sessionId, pushError],
  );

  useEffect(() => {
    const v = new VoiceEngine(getCreds, {
      onStatus: setVoiceStatus,
      onPartial: setPartial,
      onFinal: (t) => void onFinal(t),
      onProvider: setVoiceProvider,
      onError: pushError,
    });
    voiceRef.current = v;
    return () => v.destroy();
  }, [getCreds, onFinal, pushError]);

  // Speak every new assistant message exactly once.
  const spokenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!messages?.length) return;
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    if (last && !spokenRef.current.has(last._id)) {
      spokenRef.current.add(last._id);
      void voiceRef.current?.speak(last.content);
    }
  }, [messages]);

  // Silence nudges: if the user hasn't spoken and the step is a loop, prompt.
  useEffect(() => {
    if (phase !== 'incident' || !incident?.protocolId || !incident.stepId || !isProtocolId(incident.protocolId)) return;
    const step = getProtocol(incident.protocolId).steps[incident.stepId];
    const every = step?.loop?.remindEverySec ?? (step?.ask ? 25 : 0);
    if (!every) return;
    const t = setInterval(() => {
      const silent = (Date.now() - Math.max(lastUserSpeechAt.current, incident.openedAt)) / 1000;
      if (silent >= every && voiceStatus !== 'speaking' && incidentIdRef.current) {
        lastUserSpeechAt.current = Date.now();
        void nudge({ incidentId: incidentIdRef.current, silentSec: silent });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [phase, incident?.protocolId, incident?.stepId, incident?.openedAt, nudge, voiceStatus]);

  // Incident closed by coach / helper → move phase.
  useEffect(() => {
    if (incident && incident.status !== 'open' && phase === 'incident') {
      setPhase('resolved');
      voiceRef.current?.stopListening();
    }
  }, [incident, phase]);

  // ── Geo ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const stop = watchPosition((g) => {
      geoRef.current = g;
      setGeo(g);
    });
    return stop;
  }, []);
  const locationSentRef = useRef(false);
  useEffect(() => {
    if (!incidentId || !geo || locationSentRef.current) return;
    locationSentRef.current = true;
    void (async () => {
      const text = await describeLocation(geo.lat, geo.lng);
      await updateLocation({ incidentId, lat: geo.lat, lng: geo.lng, locationText: text ?? undefined });
    })();
  }, [incidentId, geo, updateLocation]);

  // ── Camera loop ───────────────────────────────────────────────────────────
  const streamRef = useRef<MediaStream | null>(null);
  const motionPrev = useRef<{ data: Uint8ClampedArray | null }>({ data: null });
  const inflight = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  useEffect(() => {
    if (phase !== 'scanning' && phase !== 'incident') return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const v = videoRef.current;
      const interval = phaseRef.current === 'incident' ? INCIDENT_INTERVAL_MS : SCAN_INTERVAL_MS;
      if (v && v.readyState >= 2 && !inflight.current && navigator.onLine) {
        const motion = motionScore(v, motionPrev.current);
        const shouldUpload = phaseRef.current === 'incident' || motion > MIN_MOTION_TO_UPLOAD || !scene;
        if (shouldUpload) {
          const jpeg = captureJpegBase64(v);
          if (jpeg) {
            inflight.current = true;
            try {
              const g = geoRef.current;
              const r = await analyzeFrame({ sessionId, jpegBase64: jpeg, incidentId: incidentIdRef.current ?? undefined, lat: g?.lat, lng: g?.lng });
              if (r.ok && r.assessment) {
                setLatencyMs(r.latencyMs ?? null);
                setScene({ people: r.assessment.people, hazards: r.assessment.hazards, resources: r.assessment.resources });
                setLastSummary(r.assessment.summary);
                if (r.incidentId && !incidentIdRef.current) {
                  setIncidentId(r.incidentId);
                  setPhase('incident');
                  await voiceRef.current?.startListening();
                }
              } else if (!r.ok) pushError(r.reason);
            } catch (e) {
              pushError(`frame: ${(e as Error).message}`);
            } finally {
              inflight.current = false;
            }
          }
        }
      }
      setTimeout(tick, interval);
    };
    void tick();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, analyzeFrame, sessionId]);

  // ── Public controls ───────────────────────────────────────────────────────
  const start = useCallback(async () => {
    setCameraError(null);
    try {
      if (videoRef.current) streamRef.current = await openCamera(videoRef.current);
    } catch (e) {
      setCameraError((e as Error).message);
    }
    await voiceRef.current?.init();
    setPhase('scanning');
  }, []);

  const emergencyNow = useCallback(async () => {
    if (phase === 'idle') await start();
    const g = geoRef.current;
    const id = await openManual({ sessionId, lat: g?.lat, lng: g?.lng });
    setIncidentId(id);
    setPhase('incident');
    await voiceRef.current?.startListening();
  }, [phase, start, openManual, sessionId]);

  const callEmergency = useCallback(() => {
    if (incidentId) void markCalled({ incidentId });
  }, [incidentId, markCalled]);

  const endIncident = useCallback(
    async (resolution: string, cancelled = false) => {
      if (!incidentId) return;
      await resolveIncident({ incidentId, resolution, cancelled });
      voiceRef.current?.stopListening();
      voiceRef.current?.stopSpeaking();
      setPhase('resolved');
    },
    [incidentId, resolveIncident],
  );

  const reset = useCallback(() => {
    setIncidentId(null);
    setScene(null);
    setLastSummary('');
    spokenRef.current.clear();
    locationSentRef.current = false;
    setPhase('scanning');
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    voiceRef.current?.stopListening();
    voiceRef.current?.stopSpeaking();
    setPhase('idle');
  }, []);

  const sendText = useCallback((text: string) => void onFinal(text), [onFinal]);

  const arHint: ArHint | null = useMemo(() => {
    if (!incident?.protocolId || !incident.stepId || !isProtocolId(incident.protocolId)) return null;
    return getProtocol(incident.protocolId).steps[incident.stepId]?.ar ?? null;
  }, [incident?.protocolId, incident?.stepId]);

  return {
    sessionId, videoRef, audioCtxRef, phase, incident, incidentId, messages, alerts, helpers, resources, afterAction,
    scene, lastSummary, voiceStatus, voiceProvider, partial, errors, latencyMs, cameraError, geo, arHint,
    start, stop, emergencyNow, callEmergency, endIncident, reset, sendText,
    setMuted: (m: boolean) => voiceRef.current?.setMuted(m),
    repeat: () => {
      const last = [...(messages ?? [])].reverse().find((m) => m.role === 'assistant');
      if (last) void voiceRef.current?.speak(last.content);
    },
  };
}
