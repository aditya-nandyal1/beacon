import { useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';

/** Live incident board (Convex subscriptions) + Elastic search over history. */
export function OpsBoard({ onBack }: { onBack: () => void }) {
  const open = useQuery(api.incidents.listOpen, {});
  const search = useAction(api.search.incidents);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Array<Record<string, unknown>> | null>(null);
  const [err, setErr] = useState<string | undefined>();

  return (
    <main className="ops">
      <button className="link" onClick={onBack}>← Back</button>
      <h2>Ops board</h2>
      <h3>Open incidents <span className="pill scan">live</span></h3>
      {!open?.length && <p className="muted">None open.</p>}
      {open?.map((i) => (
        <div key={i._id} className="req">
          <div className="reqhead"><span className={`sev ${i.severity}`}>{i.severity}</span> {i.situation.replace(/_/g, ' ')} · {i.stepId ?? '—'} · {new Date(i.openedAt).toLocaleTimeString()}</div>
          <div>{i.summary}</div>
          <div className="tiny">{i.locationText ?? (i.lat != null ? `${i.lat.toFixed(4)}, ${i.lng?.toFixed(4)}` : 'no location')} · 911 {i.calledEmergency ? 'confirmed' : 'unconfirmed'} · {i.turns} turns</div>
        </div>
      ))}
      <h3>Search history (Elastic)</h3>
      <form className="typed" onSubmit={async (e) => { e.preventDefault(); const r = await search({ query: q }); setHits(r.hits); setErr(r.error); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. cardiac arrest Mission district" />
        <button type="submit">Search</button>
      </form>
      {err && <p className="tiny warn">{err}</p>}
      {hits?.map((h, i) => (
        <div key={i} className="req"><div className="reqhead">{String(h.situation ?? h.type)}</div><div>{String(h.summary ?? '')}</div><div className="tiny">{String(h['@timestamp'] ?? '')}</div></div>
      ))}
    </main>
  );
}
