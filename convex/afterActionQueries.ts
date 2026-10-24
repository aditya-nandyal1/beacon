import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

export const setStatus = internalMutation({
  args: { incidentId: v.id('incidents'), status: v.union(v.literal('requested'), v.literal('generating'), v.literal('ready'), v.literal('failed')) },
  handler: async (ctx, { incidentId, status }) => {
    const row = await ctx.db.query('afterActionReports').withIndex('by_incident', (q) => q.eq('incidentId', incidentId)).first();
    if (row) await ctx.db.patch(row._id, { status, updatedAt: Date.now() });
    else await ctx.db.insert('afterActionReports', { incidentId, status, createdAt: Date.now(), updatedAt: Date.now() });
  },
});

export const setReport = internalMutation({
  args: {
    incidentId: v.id('incidents'),
    markdown: v.string(),
    jiraKey: v.optional(v.string()),
    jiraUrl: v.optional(v.string()),
    agentTrace: v.optional(v.array(v.object({ at: v.number(), kind: v.string(), text: v.string() }))),
  },
  handler: async (ctx, { incidentId, ...rest }) => {
    const row = await ctx.db.query('afterActionReports').withIndex('by_incident', (q) => q.eq('incidentId', incidentId)).first();
    const patch = { ...rest, status: 'ready' as const, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert('afterActionReports', { incidentId, createdAt: Date.now(), ...patch });
  },
});

export const appendTrace = internalMutation({
  args: { incidentId: v.id('incidents'), entry: v.object({ at: v.number(), kind: v.string(), text: v.string() }) },
  handler: async (ctx, { incidentId, entry }) => {
    const row = await ctx.db.query('afterActionReports').withIndex('by_incident', (q) => q.eq('incidentId', incidentId)).first();
    if (!row) return;
    await ctx.db.patch(row._id, { agentTrace: [...(row.agentTrace ?? []), entry].slice(-200), updatedAt: Date.now() });
  },
});
