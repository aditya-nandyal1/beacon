import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';

/**
 * Helper network — "Meta: bringing people closer together".
 *
 * Trained bystanders (CPR-certified, nurses, off-duty EMTs) opt in with their
 * skills and a coarse location. When an incident needs hands, we notify the
 * closest ones. Primary path is the Fetch.ai dispatch agent; this file is the
 * in-database fallback and the state store for both.
 */

const R = 6371000;
function distM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const register = mutation({
  args: { sessionId: v.string(), name: v.string(), skills: v.array(v.string()), lat: v.number(), lng: v.number(), available: v.boolean(), agentAddress: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('helpers').withIndex('by_session', (q) => q.eq('sessionId', args.sessionId)).first();
    const row = { ...args, lastSeen: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert('helpers', row);
  },
});

export const me = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => ctx.db.query('helpers').withIndex('by_session', (q) => q.eq('sessionId', sessionId)).first(),
});

/** Incidents this helper has been pinged about (live, reactive). */
export const myRequests = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const rows = await ctx.db.query('helperResponses').withIndex('by_helper', (q) => q.eq('helperSessionId', sessionId)).order('desc').take(10);
    const out = [];
    for (const r of rows) {
      const inc = await ctx.db.get(r.incidentId);
      if (inc && inc.status === 'open') out.push({ response: r, incident: inc });
    }
    return out;
  },
});

export const respond = mutation({
  args: { incidentId: v.id('incidents'), sessionId: v.string(), status: v.union(v.literal('accepted'), v.literal('declined'), v.literal('arrived')), etaSec: v.optional(v.number()) },
  handler: async (ctx, { incidentId, sessionId, status, etaSec }) => {
    const rows = await ctx.db.query('helperResponses').withIndex('by_incident', (q) => q.eq('incidentId', incidentId)).collect();
    const mine = rows.find((r) => r.helperSessionId === sessionId);
    if (!mine) return;
    await ctx.db.patch(mine._id, { status, etaSec, at: Date.now() });
    const helper = await ctx.db.query('helpers').withIndex('by_session', (q) => q.eq('sessionId', sessionId)).first();
    const label = helper?.name ?? 'A helper';
    const text = status === 'accepted' ? `[helper ${label} is on the way${etaSec ? `, about ${Math.round(etaSec / 60)} min` : ''}]` : status === 'arrived' ? `[helper ${label} has arrived]` : `[helper ${label} declined]`;
    await ctx.db.insert('messages', { incidentId, role: 'system', content: text, at: Date.now() });
  },
});

export const enRouteCount = internalQuery({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }) => {
    const rows = await ctx.db.query('helperResponses').withIndex('by_incident', (q) => q.eq('incidentId', incidentId)).collect();
    return rows.filter((r) => r.status === 'accepted').length;
  },
});

/** Fallback geo-dispatch when the Fetch.ai agent is unavailable. */
export const notifyNearby = internalMutation({
  args: { incidentId: v.id('incidents'), radiusM: v.optional(v.number()) },
  handler: async (ctx, { incidentId, radiusM = 1500 }) => {
    const inc = await ctx.db.get(incidentId);
    if (!inc || inc.lat == null || inc.lng == null) return 0;
    const already = new Set((await ctx.db.query('helperResponses').withIndex('by_incident', (q) => q.eq('incidentId', incidentId)).collect()).map((r) => r.helperSessionId));
    const cutoff = Date.now() - 6 * 3600_000;
    const helpers = (await ctx.db.query('helpers').collect()).filter((h) => h.available && h.lastSeen > cutoff && h.sessionId !== inc.sessionId && !already.has(h.sessionId));
    const ranked = helpers
      .map((h) => ({ h, d: distM(inc.lat!, inc.lng!, h.lat, h.lng) }))
      .filter((x) => x.d <= radiusM)
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
    for (const { h, d } of ranked) {
      await ctx.db.insert('helperResponses', { incidentId, helperSessionId: h.sessionId, helperName: h.name, status: 'notified', distanceM: Math.round(d), etaSec: Math.round(d / 1.4), at: Date.now() });
    }
    if (ranked.length) {
      await ctx.db.insert('messages', { incidentId, role: 'system', content: `[${ranked.length} nearby trained helper(s) notified]`, at: Date.now() });
      await ctx.db.patch(incidentId, { helpersRequested: true });
    }
    return ranked.length;
  },
});

/** Called by the Fetch.ai agent (via HTTP route) when a responder accepts. */
export const externalResponse = internalMutation({
  args: { incidentId: v.id('incidents'), helperName: v.string(), helperSessionId: v.string(), status: v.union(v.literal('notified'), v.literal('accepted'), v.literal('declined'), v.literal('arrived')), distanceM: v.number(), etaSec: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('helperResponses').withIndex('by_incident', (q) => q.eq('incidentId', args.incidentId)).collect();
    const existing = rows.find((r) => r.helperSessionId === args.helperSessionId);
    if (existing) await ctx.db.patch(existing._id, { status: args.status, etaSec: args.etaSec, at: Date.now() });
    else await ctx.db.insert('helperResponses', { ...args, at: Date.now() });
    if (args.status === 'accepted') {
      await ctx.db.insert('messages', { incidentId: args.incidentId, role: 'system', content: `[helper ${args.helperName} is on the way via Fetch.ai dispatch${args.etaSec ? `, ~${Math.round(args.etaSec / 60)} min` : ''}]`, at: Date.now() });
    }
  },
});
