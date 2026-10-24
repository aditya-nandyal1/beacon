import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { watchPosition, type Geo } from '../lib/geo';

const SKILLS = ['CPR certified', 'First aid', 'Nurse', 'EMT / paramedic', 'Physician', 'Lifeguard', 'Stop the Bleed', 'Ham radio'];

/**
 * Helper network — trained bystanders opt in and get pinged for nearby incidents.
 * Updates in real time through Convex subscriptions; acceptance flows back into
 * the victim's coach ("a nurse is 2 minutes away").
 */
export function HelperMode({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const me = useQuery(api.helpers.me, { sessionId });
  const requests = useQuery(api.helpers.myRequests, { sessionId });
  const register = useMutation(api.helpers.register);
  const respond = useMutation(api.helpers.respond);
  const [name, setName] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);

  useEffect(() => watchPosition(setGeo), []);
  useEffect(() => {
    if (me) {
      setName(me.name);
      setSkills(me.skills);
    }
  }, [me]);
  // Heartbeat location while available.
  useEffect(() => {
    if (!me?.available || !geo) return;
    const t = setInterval(() => void register({ sessionId, name: me.name, skills: me.skills, lat: geo.lat, lng: geo.lng, available: true }), 60_000);
    return () => clearInterval(t);
  }, [me, geo, register, sessionId]);

  const save = (available: boolean) => {
    if (!geo || !name.trim()) return;
    void register({ sessionId, name: name.trim(), skills, lat: geo.lat, lng: geo.lng, available });
  };

  return (
    <main className="helper">
      <button className="link" onClick={onBack}>← Back</button>
      <h2>Helper network</h2>
      <p className="muted">When someone nearby is in trouble, Beacon pings the closest trained people. You decide every time.</p>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="How Beacon introduces you" /></label>
      <div className="chips">
        {SKILLS.map((s) => (
          <button key={s} className={`chip ${skills.includes(s) ? 'on' : ''}`} onClick={() => setSkills(skills.includes(s) ? skills.filter((x) => x !== s) : [...skills, s])}>{s}</button>
        ))}
      </div>
      <div className="row">
        <button className="primary" disabled={!geo || !name.trim()} onClick={() => save(true)}>{me?.available ? 'Available ✓' : 'Go available'}</button>
        {me?.available && <button className="ghost" onClick={() => save(false)}>Go offline</button>}
      </div>
      {!geo && <p className="tiny">Waiting for location permission…</p>}

      <h3>Requests</h3>
      {!requests?.length && <p className="muted">Nothing right now. Keep this page open; it updates live.</p>}
      {requests?.map(({ response, incident }) => (
        <div key={response._id} className={`req ${response.status}`}>
          <div className="reqhead"><span className={`sev ${incident.severity}`}>{incident.severity}</span> {incident.situation.replace(/_/g, ' ')} · {Math.round(response.distanceM)} m</div>
          <div>{incident.summary}</div>
          {incident.locationText && <div className="tiny">{incident.locationText}</div>}
          {incident.lat != null && <a className="tiny" href={`https://maps.google.com/?q=${incident.lat},${incident.lng}`} target="_blank" rel="noreferrer">Open in maps ↗</a>}
          <div className="row">
            {response.status === 'notified' && (
              <>
                <button className="primary" onClick={() => void respond({ incidentId: incident._id, sessionId, status: 'accepted', etaSec: response.etaSec })}>I'm coming</button>
                <button className="ghost" onClick={() => void respond({ incidentId: incident._id, sessionId, status: 'declined' })}>Can't</button>
              </>
            )}
            {response.status === 'accepted' && <button className="primary" onClick={() => void respond({ incidentId: incident._id, sessionId, status: 'arrived' })}>I've arrived</button>}
            {response.status === 'arrived' && <span className="pill ok">On scene</span>}
          </div>
        </div>
      ))}
    </main>
  );
}
