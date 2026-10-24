export async function createJiraIssue(opts: { summary: string; description: string; labels: string[] }): Promise<{ key?: string; url?: string; error?: string; skipped?: boolean }> {
  const { JIRA_BASE_URL: base, JIRA_EMAIL: email, JIRA_API_TOKEN: token, JIRA_PROJECT_KEY: project } = process.env;
  if (!base || !email || !token || !project) return { skipped: true, error: 'Jira not configured' };
  const r = await fetch(`${base.replace(/\/$/, '')}/rest/api/3/issue`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'), 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      fields: {
        project: { key: project }, summary: opts.summary.slice(0, 250), issuetype: { name: 'Task' }, labels: opts.labels,
        description: { type: 'doc', version: 1, content: opts.description.split('\n').filter(Boolean).map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p.slice(0, 5000) }] })) },
      },
    }),
  });
  const j = (await r.json()) as { key?: string; errorMessages?: string[] };
  if (!r.ok) return { error: j.errorMessages?.join('; ') ?? `HTTP ${r.status}` };
  return { key: j.key, url: `${base.replace(/\/$/, '')}/browse/${j.key}` };
}
