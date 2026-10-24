import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { severity } from './schema';
import { internal } from './_generated/api';

// ───────────────────────────── public queries ─────────────────────────────

export const get = query({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }) => ctx.db.get(incidentId),
});

export const activeForSession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const rows = await ctx.db
      .query('incidents')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .order('desc')
      .take(5);
    return rows.find((r) => r.status === 'open') ?? null;
  },
});

export const listOpen = query({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query('incidents')
      .withIndex('by_status', (q) => q.eq('status', 'open'))
      .order('desc')
      .take(50),
});

export const messages = query({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }) =>
    ctx.db
      .query('messages')
      .withIndex('by_incident', (q) => q.eq('incidentId', incidentId))
      .order('asc')
      .take(200),
});

export const alerts = query({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }) =>
    ctx.db
      .query('alerts')
      .withIndex('by_incident', (q) => q.eq('incidentId', incidentId))
      .order('desc')
      .take(50),
});

export const helperResponses = query({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }) =>
    ctx.db
      .query('helperResponses')
      .withIndex('by_incident', (q) => q.eq('incidentId', incidentId))
      .collect(),
});

export const resources = query({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }) =>
    ctx.db
      .query('resources')
      .withIndex('by_incident', (q) => q.eq('incidentId', incidentId))
      .collect(),
});

export const afterAction = query({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }) =>
    ctx.db
      .query('afterActionReports')
      .withIndex('by_incident', (q) => q.eq('incidentId', incidentId))
      .first(),
});

export const history = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) =>
    ctx.db
      .query('incidents')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .order('desc')
      .take(30),
});

// ───────────────────────────── public mutations ───────────────────────────

/** User taps the red button. We record it; the phone places the actual call via tel:. */
export const markCalled = mutation({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }) => {
    const inc = await ctx.db.get(incidentId);
    if (!inc || inc.calledEmergency) return;
    await ctx.db.patch(incidentId, { calledEmergency: true, calledAt: Date.now() });
    await ctx.db.insert('messages', { incidentId, role: 'system', content: '[user placed 911 call]', at: Date.now() });
  },
});

export const updateLocation = mutation({
  args: { incidentId: v.id('incidents'), lat: v.number(), lng: v.number(), locationText: v.optional(v.string()) },
  handler: async (ctx, { incidentId, ...loc }) => {
    await ctx.db.patch(incidentId, loc);
  },
});

/** Manual open — "I'm in an emergency" button, when the camera hasn't caught it. */
export const openManual = mutation({
  args: { sessionId: v.string(), lat: v.optional(v.number()), lng: v.optional(v.number()) },
  handler: async (ctx, { sessionId, lat, lng }) => {
    const now = Date.now();
    const id = await ctx.db.insert('incidents', {
      sessionId,
      status: 'open',
      situation: 'unclear',
      protocolId: 'general_scene_safety',
      stepId: 'describe',
      severity: 'moderate',
      summary: 'User reported an emergency.',
      openedAt: now,
      lat,
      lng,
      calledEmergency: false,
      helpersRequested: false,
      turns: 0,
    });
    await ctx.db.insert('messages', { incidentId: id, role: 'system', content: '[incident opened manually]', at: now });
    await ctx.scheduler.runAfter(0, internal.coach.openingLine, { incidentId: id });
    if (lat != null && lng != null) await ctx.scheduler.runAfter(0, internal.enrichment.enrichIncident, { incidentId: id });
    return id;
  },
});

export const resolve = mutation({
  args: { incidentId: v.id('incidents'), resolution: v.string(), cancelled: v.optional(v.boolean()) },
  handler: async (ctx, { incidentId, resolution, cancelled }) => {
    const inc = await ctx.db.get(incidentId);
    if (!inc || inc.status !== 'open') return;
    await ctx.db.patch(incidentId, { status: cancelled ? 'cancelled' : 'resolved', resolvedAt: Date.now(), resolution });
    await ctx.db.insert('messages', { incidentId, role: 'system', content: `[incident ${cancelled ? 'cancelled' : 'resolved'}: ${resolution}]`, at: Date.now() });
    if (!cancelled) {
      await ctx.db.insert('afterActionReports', { incidentId, status: 'requested', createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.afterAction.requestReport, { incidentId });
    }
  },
});

/** Helpers (or the owner) can post text into the incident channel. */
export const postMessage = mutation({
  args: { incidentId: v.id('incidents'), sessionId: v.string(), content: v.string() },
  handler: async (ctx, { incidentId, sessionId, content }) => {
    await ctx.db.insert('messages', { incidentId, role: 'user', content, at: Date.now(), sessionId });
  },
});

// ───────────────────────────── internal ───────────────────────────────────

export const open = internalMutation({
  args: {
    sessionId: v.string(),
    situation: v.string(),
    protocolId: v.union(v.string(), v.null()),
    stepId: v.union(v.string(), v.null()),
    severity,
    summary: v.string(),
    assessment: v.any(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert('incidents', {
      ...args,
      status: 'open',
      openedAt: now,
      calledEmergency: false,
      helpersRequested: false,
      turns: 0,
    });
    await ctx.db.insert('messages', { incidentId: id, role: 'system', content: `[incident opened: ${args.summary}]`, at: now });
    return id;
  },
});

export const recordObservation = internalMutation({
  args: {
    sessionId: v.string(),
    incidentId: v.optional(v.id('incidents')),
    situation: v.string(),
    confidence: v.number(),
    severity,
    assessment: v.any(),
    provider: v.string(),
    model: v.string(),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('observations', { ...args, at: Date.now() });
    if (args.incidentId) await ctx.db.patch(args.incidentId, { assessment: args.assessment });
  },
});

export const recentObservations = internalQuery({
  args: { sessionId: v.string(), limit: v.number() },
  handler: async (ctx, { sessionId, limit }) =>
    ctx.db
      .query('observations')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .order('desc')
      .take(limit),
});

export const getInternal = internalQuery({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }) => ctx.db.get(incidentId),
});

export const messagesInternal = internalQuery({
  args: { incidentId: v.id('incidents'), limit: v.number() },
  handler: async (ctx, { incidentId, limit }) => {
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_incident', (q) => q.eq('incidentId', incidentId))
      .order('desc')
      .take(limit);
    return rows.reverse();
  },
});

export const appendMessage = internalMutation({
  args: {
    incidentId: v.id('incidents'),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
    content: v.string(),
    turn: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('messages', { ...args, at: Date.now() });
  },
});

export const applyTurn = internalMutation({
  args: {
    incidentId: v.id('incidents'),
    protocolId: v.union(v.string(), v.null()),
    stepId: v.union(v.string(), v.null()),
    helpersRequested: v.optional(v.boolean()),
    endIncident: v.optional(v.boolean()),
  },
  handler: async (ctx, { incidentId, protocolId, stepId, helpersRequested, endIncident }) => {
    const inc = await ctx.db.get(incidentId);
    if (!inc) return;
    const patch: Record<string, unknown> = { protocolId, stepId, turns: inc.turns + 1 };
    if (protocolId && protocolId !== inc.situation) patch.situation = protocolId;
    if (helpersRequested) patch.helpersRequested = true;
    if (endIncident && inc.status === 'open') {
      patch.status = 'resolved';
      patch.resolvedAt = Date.now();
      patch.resolution = 'handed off';
      await ctx.db.insert('afterActionReports', { incidentId, status: 'requested', createdAt: Date.now(), updatedAt: Date.now() });
    }
    await ctx.db.patch(incidentId, patch);
  },
});

export const setContext = internalMutation({
  args: {
    incidentId: v.id('incidents'),
    context: v.object({
      nearestAed: v.optional(v.string()),
      liveAlerts: v.optional(v.array(v.string())),
      roadClosures: v.optional(v.array(v.string())),
      hospitals: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, { incidentId, context }) => {
    const inc = await ctx.db.get(incidentId);
    if (!inc) return;
    await ctx.db.patch(incidentId, { context: { ...(inc.context ?? {}), ...context } });
  },
});

export const recordAlert = internalMutation({
  args: {
    incidentId: v.id('incidents'),
    channel: v.union(v.literal('sms'), v.literal('dispatch_webhook'), v.literal('fetchai'), v.literal('jira'), v.literal('elastic'), v.literal('droid')),
    status: v.union(v.literal('queued'), v.literal('sent'), v.literal('failed'), v.literal('skipped')),
    payload: v.any(),
    error: v.optional(v.string()),
    externalId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('alerts', { ...args, at: Date.now() });
  },
});

export const addResources = internalMutation({
  args: {
    incidentId: v.id('incidents'),
    items: v.array(
      v.object({
        kind: v.union(v.literal('aed'), v.literal('shelter'), v.literal('hospital'), v.literal('fire_station')),
        name: v.string(),
        lat: v.number(),
        lng: v.number(),
        address: v.optional(v.string()),
        source: v.string(),
      }),
    ),
  },
  handler: async (ctx, { incidentId, items }) => {
    for (const it of items) await ctx.db.insert('resources', { ...it, incidentId, fetchedAt: Date.now() });
  },
});

export const emergencyContacts = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) =>
    ctx.db
      .query('emergencyContacts')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .collect(),
});

export const upsertEmergencyContact = mutation({
  args: { sessionId: v.string(), name: v.string(), phone: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert('emergencyContacts', args);
  },
});

export const myEmergencyContacts = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) =>
    ctx.db
      .query('emergencyContacts')
      .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
      .collect(),
});
