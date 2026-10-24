/** Run the after-action agent once against a sample payload (for demos / CI). */
import { readFile } from 'node:fs/promises';
import { runAfterAction, IncidentPayload } from './afterAction.js';
import { createJiraIssue } from './jira.js';

const file = process.argv[2] ?? new URL('../sample-incident.json', import.meta.url).pathname;
const payload = IncidentPayload.parse(JSON.parse(await readFile(file, 'utf8')));
const out = await runAfterAction(payload, {
  onTrace: (t) => console.log(`[${t.kind}] ${t.text}`),
  jira: (s, d, l) => createJiraIssue({ summary: s, description: d, labels: l }),
});
console.log('\n' + out.markdown);
