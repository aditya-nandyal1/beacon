import { v } from 'convex/values';
import { internalQuery } from './_generated/server';

export const sentChannels = internalQuery({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }) => {
    const rows = await ctx.db
      .query('alerts')
      .withIndex('by_incident', (q) => q.eq('incidentId', incidentId))
      .collect();
    return rows.filter((r) => r.status === 'sent').map((r) => r.channel);
  },
});

export const allForIncident = internalQuery({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }) =>
    ctx.db.query('alerts').withIndex('by_incident', (q) => q.eq('incidentId', incidentId)).order('asc').collect(),
});
