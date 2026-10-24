import { useEffect, useMemo, useState } from 'react';
import { getProtocol, isProtocolId } from '@beacon/protocols';
import { useIncidentEngine } from './hooks/useIncidentEngine';
import { useMetronome } from './hooks/useMetronome';
import { AROverlay } from './components/AROverlay';
import { IncidentPanel } from './components/IncidentPanel';
import { HelperMode } from './components/HelperMode';
import { AfterAction } from './components/AfterAction';
import { OpsBoard } from './components/OpsBoard';
import { EMERGENCY_NUMBER } from './lib/session';

type View = 'main' | 'helper' | 'ops';

export default function App() {
  const eng = useIncidentEngine();
  const [view, setView] = useState<View>(() => (location.pathname.startsWith('/helper') ? 'helper' : location.pathname.startsWith('/ops') ? 'ops' : 'main'));
  const [muted, setMuted] = useState(false);
  const bpm = eng.arHint?.kind === 'cpr_metronome' ? eng.arHint.bpm : null;
  const beatRef = useMetronome(bpm, eng.audioCtxRef);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('emergency') === '1' && eng.phase === 'idle') void eng.emergencyNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const protocol = useMemo(() => (eng.incident?.protocolId && isProtocolId(eng.incident.protocolId) ? getProtocol(eng.incident.protocolId) : null), [eng.incident?.protocolId]);
  const step = protocol && eng.incident?.stepId ? protocol.steps[eng.incident.stepId] : null;

  if (view === 'helper') return <HelperMode sessionId={eng.sessionId} onBack={() => setView('main')} />;
  if (view === 'ops') return <OpsBoard onBack={() => setView('main')} />;

  return (
    <div className={`app phase-${eng.phase}`}>
      <video ref={eng.videoRef} className="camera" muted playsInline />
      <AROverlay scene={eng.scene} hint={eng.arHint} videoRef={eng.videoRef} beatRef={beatRef} />

      {/* Top bar */}
      <header className="top">
        <div className="brand">
          <span className="dot" /> Beacon
        </div>
        <div className="status">
          {eng.phase === 'scanning' && <span className="pill scan">Watching{eng.latencyMs ? ` · ${(eng.latencyMs / 1000).toFixed(1)}s` : ''}</span>}
          {eng.phase === 'incident' && <span className={`pill voice ${eng.voiceStatus}`}>{eng.voiceStatus === 'speaking' ? 'Speaking' : eng.voiceStatus === 'thinking' ? 'Thinking' : eng.voiceStatus === 'listening' ? 'Listening' : 'Voice'}</span>}
          <span className="pill dim">{eng.voiceProvider === 'cartesia' ? 'Cartesia' : 'Browser voice'}</span>
          {!navigator.onLine && <span className="pill warn">Offline</span>}
        </div>
      </header>

      {/* Idle */}
      {eng.phase === 'idle' && (
        <main className="idle">
          <h1>Point your phone at the emergency.</h1>
          <p>Beacon watches the scene, talks you through what to do, shows you where to put your hands, and gets help moving. No account. No video stored.</p>
          <button className="primary" onClick={() => void eng.start()}>Start watching</button>
          <button className="danger big" onClick={() => void eng.emergencyNow()}>I'm in an emergency now</button>
          <div className="links">
            <button className="link" onClick={() => setView('helper')}>I'm trained — join the helper network</button>
            <button className="link" onClick={() => setView('ops')}>Ops board</button>
          </div>
          {eng.cameraError && <p className="err">Camera: {eng.cameraError}. You can still use the emergency button and talk to Beacon.</p>}
        </main>
      )}

      {/* Scanning */}
      {eng.phase === 'scanning' && (
        <main className="scan">
          <div className="summary">{eng.lastSummary || 'Looking at the scene…'}</div>
          <button className="danger big" onClick={() => void eng.emergencyNow()}>I'm in an emergency now</button>
          <button className="ghost" onClick={eng.stop}>Stop</button>
        </main>
      )}

      {/* Incident */}
      {eng.phase === 'incident' && eng.incident && (
        <IncidentPanel
          incident={eng.incident}
          protocol={protocol}
          step={step}
          messages={eng.messages ?? []}
          alerts={eng.alerts ?? []}
          helpers={eng.helpers ?? []}
          resources={eng.resources ?? []}
          partial={eng.partial}
          voiceStatus={eng.voiceStatus}
          emergencyNumber={EMERGENCY_NUMBER}
          onCall={eng.callEmergency}
          onRepeat={eng.repeat}
          onMute={(m) => {
            setMuted(m);
            eng.setMuted(m);
          }}
          muted={muted}
          onSend={eng.sendText}
          onEnd={(why, cancelled) => void eng.endIncident(why, cancelled)}
        />
      )}

      {/* Resolved */}
      {eng.phase === 'resolved' && eng.incident && (
        <AfterAction incident={eng.incident} report={eng.afterAction ?? null} messages={eng.messages ?? []} onNew={eng.reset} />
      )}

      {eng.errors.length > 0 && eng.phase !== 'idle' && (
        <div className="errors">{eng.errors.slice(-1).map((e, i) => <div key={i}>{e}</div>)}</div>
      )}
    </div>
  );
}
