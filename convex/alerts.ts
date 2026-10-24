'use node';

import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { getProtocol, isProtocolId } from '@beacon/protocols';
import { indexIncidentEvent } from './lib/elastic';
import { notifyFetchAgent } from './lib/fetchai';
import type { Doc } from './_generated/dataModel';

/**
 * dispatchIncident — fan out an incident packet to every configured channel.
 *
 * Design decisions (disaster-mitigation hat on):
 *  - We NEVER auto-dial 911 from software. False positives would clog PSAPs and
 *    there is no way to carry context on a voice line we don't control. Instead:
 *      1. the phone surfaces a one-tap tel:911 button (and the coach says so),
 *      2. we POST a structured packet to a dispatch data channel (NG911 /
 *         RapidSOS-style webhook) when one is configured,
 *      3. we SMS the user's emergency contacts with a live link,
 *      4. we notify the Fetch.ai helper agent so trained bystanders nearby get pinged.
 *  - Idempotent per (incident, channel): re-running never double-alerts.
 *  - Every channel records an `alerts` row so the UI shows exactly what went out.
 */
export const dispatchIncident = internalAction({
  args: { incidentId: v.id('incidents'), reason: v.string() },
  handler: async (ctx, { incidentId, reason }): Promise<void> => {
    const inc: Doc<'incidents'> | null = await ctx.runQuery(internal.incidents.getInternal, { incidentId });
    if (!inc || inc.status !== 'open') return;
    const existing: string[] = await ctx.runQuery(internal.alertsQueries.sentChannels, { incidentId });

    const protocol = inc.protocolId && isProtocolId(inc.protocolId) ? getProtocol(inc.protocolId) : null;
    const packet = {
      incidentId: String(incidentId),
      openedAt: new Date(inc.openedAt).toISOString(),
      reason,
      situation: inc.situation,
      protocol: protocol ? { id: protocol.id, title: protocol.title } : null,
      severity: inc.severity,
      summary: inc.summary,
      location: inc.lat != null && inc.lng != null ? { lat: inc.lat, lng: inc.lng, text: inc.locationText ?? null } : null,
      people: (inc.assessment?.people ?? []).map((p: { state: string; posture: string; injuries: string[] }) => ({ state: p.state, posture: p.posture, injuries: p.injuries })),
      hazards: (inc.assessment?.hazards ?? []).map((h: { label: string; kind: string; urgent: boolean }) => ({ label: h.label, kind: h.kind, urgent: h.urgent })),
      liveLink: `${process.env.PUBLIC_APP_URL ?? 'https://beacon.local'}/incident/${incidentId}`,
    };

    // 1) Dispatch data channel (NG911-style webhook)
    if (!existing.includes('dispatch_webhook')) {
      const url = process.env.DISPATCH_WEBHOOK_URL;
      if (!url) {
        await ctx.runMutation(internal.incidents.recordAlert, { incidentId, channel: 'dispatch_webhook', status: 'skipped', payload: packet, error: 'DISPATCH_WEBHOOK_URL not set' });
      } else {
        try {
          const body = JSON.stringify(packet);
          const sig = await hmacHex(process.env.DISPATCH_WEBHOOK_SECRET ?? '', body);
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-beacon-signature': sig }, body });
          await ctx.runMutation(internal.incidents.recordAlert, {
            incidentId, channel: 'dispatch_webhook', status: r.ok ? 'sent' : 'failed', payload: packet,
            error: r.ok ? undefined : `HTTP ${r.status}`, externalId: r.headers.get('x-request-id') ?? undefined,
          });
        } catch (e) {
          await ctx.runMutation(internal.incidents.recordAlert, { incidentId, channel: 'dispatch_webhook', status: 'failed', payload: packet, error: (e as Error).message });
        }
      }
    }

    // 2) SMS emergency contacts (Twilio) — only for high/critical
    if (!existing.includes('sms') && (inc.severity === 'high' || inc.severity === 'critical')) {
      const contacts: Doc<'emergencyContacts'>[] = await ctx.runQuery(internal.incidents.emergencyContacts, { sessionId: inc.sessionId });
      const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM_NUMBER: from } = process.env;
      if (!sid || !tok || !from || contacts.length === 0) {
        await ctx.runMutation(internal.incidents.recordAlert, { incidentId, channel: 'sms', status: 'skipped', payload: { to: contacts.map((c) => c.name) }, error: contacts.length ? 'Twilio not configured' : 'no emergency contacts' });
      } else {
        const text = `Beacon: ${inc.summary} ${packet.location ? `Location: https://maps.google.com/?q=${packet.location.lat},${packet.location.lng}` : ''} Live: ${packet.liveLink}`.trim();
        for (const c of contacts) {
          try {
            const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
              method: 'POST',
              headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ To: c.phone, From: from, Body: text }),
            });
            const j = (await r.json()) as { sid?: string; message?: string };
            await ctx.runMutation(internal.incidents.recordAlert, { incidentId, channel: 'sms', status: r.ok ? 'sent' : 'failed', payload: { to: c.name, text }, error: r.ok ? undefined : j.message, externalId: j.sid });
          } catch (e) {
            await ctx.runMutation(internal.incidents.recordAlert, { incidentId, channel: 'sms', status: 'failed', payload: { to: c.name }, error: (e as Error).message });
          }
        }
      }
    }

    // 3) Fetch.ai helper-dispatch agent
    if (!existing.includes('fetchai') && (inc.severity === 'high' || inc.severity === 'critical')) {
      const res = await notifyFetchAgent(packet);
      await ctx.runMutation(internal.incidents.recordAlert, { incidentId, channel: 'fetchai', status: res.status, payload: packet, error: res.error, externalId: res.externalId });
      if (res.status !== 'sent') {
        // Local fallback: geo-match helpers registered in Convex directly.
        await ctx.scheduler.runAfter(0, internal.helpers.notifyNearby, { incidentId });
      }
    }

    // 4) Elastic — index the event for the ops dashboard / analytics
    const el = await indexIncidentEvent({ type: 'incident.dispatched', ...packet });
    await ctx.runMutation(internal.incidents.recordAlert, { incidentId, channel: 'elastic', status: el.status, payload: { type: 'incident.dispatched' }, error: el.error, externalId: el.externalId });
  },
});

async function hmacHex(secret: string, body: string): Promise<string> {
  if (!secret) return '';
  const { createHmac } = await import('node:crypto');
  return createHmac('sha256', secret).update(body).digest('hex');
}
