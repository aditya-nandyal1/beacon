import type { Doc } from '@convex/_generated/dataModel';

export function AfterAction({ incident, report, messages, onNew }: { incident: Doc<'incidents'>; report: Doc<'afterActionReports'> | null; messages: Doc<'messages'>[]; onNew: () => void }) {
  const dur = incident.resolvedAt ? Math.round((incident.resolvedAt - incident.openedAt) / 1000) : 0;
  return (
    <main className="after">
      <h2>{incident.status === 'cancelled' ? 'Cancelled' : 'Handed off'}</h2>
      <p className="muted">{incident.summary}</p>
      <div className="stats">
        <div><b>{Math.floor(dur / 60)}m {dur % 60}s</b><span>duration</span></div>
        <div><b>{messages.filter((m) => m.role === 'assistant').length}</b><span>coach turns</span></div>
        <div><b>{incident.calledEmergency ? 'yes' : 'no'}</b><span>911 confirmed</span></div>
      </div>

      {incident.status !== 'cancelled' && (
        <section className="report">
          <h3>After-action report {report?.status === 'generating' && <span className="pill scan">Droid working…</span>}{report?.status === 'ready' && <span className="pill ok">ready</span>}{report?.status === 'failed' && <span className="pill warn">failed</span>}</h3>
          {report?.jiraUrl && <a className="jira" href={report.jiraUrl} target="_blank" rel="noreferrer">Jira {report.jiraKey} ↗</a>}
          {report?.agentTrace && report.agentTrace.length > 0 && (
            <details open>
              <summary>What the agent did ({report.agentTrace.length} steps)</summary>
              <ol className="trace">
                {report.agentTrace.map((t, i) => (
                  <li key={i}><span className={`kind ${t.kind}`}>{t.kind}</span> {t.text}</li>
                ))}
              </ol>
            </details>
          )}
          {report?.markdown ? <pre className="md">{report.markdown}</pre> : <p className="muted">Generating a timeline and follow-ups from the transcript…</p>}
        </section>
      )}

      <button className="primary" onClick={onNew}>Back to watching</button>
      <p className="tiny">You did something hard. If you need to talk to someone afterwards, that's normal — 988 (US) is free and 24/7.</p>
    </main>
  );
}
