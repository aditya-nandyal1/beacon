import { useState } from 'react';
import type { Doc } from '@convex/_generated/dataModel';
import type { Protocol, ProtocolStep } from '@beacon/protocols';
import type { VoiceStatus } from '../lib/voice';

interface Props {
  incident: Doc<'incidents'>;
  protocol: Protocol | null;
  step: ProtocolStep | null;
  messages: Doc<'messages'>[];
  alerts: Doc<'alerts'>[];
  helpers: Doc<'helperResponses'>[];
  resources: Doc<'resources'>[];
  partial: string;
  voiceStatus: VoiceStatus;
  emergencyNumber: string;
  muted: boolean;
  onCall: () => void;
  onRepeat: () => void;
  onMute: (m: boolean) => void;
  onSend: (text: string) => void;
  onEnd: (why: string, cancelled: boolean) => void;
}

export function IncidentPanel(p: Props) {
  const [text, setText] = useState('');
  const [showLog, setShowLog] = useState(false);
  const lastAssistant = [...p.messages].reverse().find((m) => m.role === 'assistant');
  const elapsed = Math.floor((Date.now() - p.incident.openedAt) / 1000);
  const accepted = p.helpers.filter((h) => h.status === 'accepted' || h.status === 'arrived');
  const sent = p.alerts.filter((a) => a.status === 'sent');
  const nearestAed = p.incident.context?.nearestAed;

  return (
    <main className="incident">
      <div className="headline">
        <div className="proto">
          <span className={`sev ${p.incident.severity}`}>{p.incident.severity}</span>
          {protocolTitle(p.protocol, p.incident.situation)}
          <span className="elapsed">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
        </div>
        {p.step && <div className="stepname">{p.step.id.replace(/_/g, ' ')}</div>}
      </div>

      <div className={`say ${p.voiceStatus}`} aria-live="assertive">
        {lastAssistant?.content ?? 'Connecting…'}
      </div>
      {p.partial && <div className="partial">“{p.partial}”</div>}

      <div className="facts">
        {nearestAed && <div className="fact aed">AED: {nearestAed}</div>}
        {p.incident.context?.liveAlerts?.[0] && <div className="fact alert">{p.incident.context.liveAlerts[0]}</div>}
        {p.incident.context?.roadClosures?.[0] && <div className="fact road">Road: {p.incident.context.roadClosures[0]}</div>}
        {accepted.length > 0 && <div className="fact helper">{accepted.length} trained helper{accepted.length > 1 ? 's' : ''} on the way{accepted[0].etaSec ? ` · ~${Math.round(accepted[0].etaSec / 60)} min` : ''}</div>}
        {sent.length > 0 && <div className="fact sent">Alerted: {[...new Set(sent.map((a) => a.channel))].join(', ')}</div>}
        {p.resources.length > 0 && !nearestAed && <div className="fact">{p.resources.length} nearby resource{p.resources.length > 1 ? 's' : ''} found</div>}
      </div>

      <div className="controls">
        <a className={`danger call ${p.incident.calledEmergency ? 'done' : ''}`} href={`tel:${p.emergencyNumber}`} onClick={p.onCall}>
          {p.incident.calledEmergency ? `Called ${p.emergencyNumber}` : `Call ${p.emergencyNumber}`}
        </a>
        <button className="ghost" onClick={p.onRepeat}>Repeat</button>
        <button className={`ghost ${p.muted ? 'on' : ''}`} onClick={() => p.onMute(!p.muted)}>{p.muted ? 'Unmute' : 'Mute mic'}</button>
      </div>

      <form
        className="typed"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) p.onSend(text.trim());
          setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Can't talk? Type here" aria-label="Type to Beacon" />
        <button type="submit">Send</button>
      </form>

      <div className="quick">
        <button onClick={() => p.onSend('Yes')}>Yes</button>
        <button onClick={() => p.onSend('No')}>No</button>
        <button onClick={() => p.onSend("I'm not sure")}>Not sure</button>
        <button onClick={() => p.onSend('Paramedics are here and have taken over')}>Help arrived</button>
      </div>

      <div className="footer">
        <button className="link" onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide' : 'Show'} log</button>
        <button className="link" onClick={() => p.onEnd('false alarm', true)}>False alarm</button>
      </div>
      {showLog && (
        <div className="log">
          {p.messages.map((m) => (
            <div key={m._id} className={`m ${m.role}`}>
              <span className="t">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> {m.content}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function protocolTitle(p: Protocol | null, situation: string) {
  return <span className="title">{p ? p.title : situation.replace(/_/g, ' ')}</span>;
}
