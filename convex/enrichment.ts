'use node';

import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { fetchLiveContext } from './lib/brightdata';
import { findNearbyResources, haversineM } from './lib/apify';
import type { Doc } from './_generated/dataModel';

/**
 * enrichIncident — runs in parallel with the first coach turn.
 *
 * Pulls what a dispatcher would have on their second screen:
 *  - nearest AED / hospital / shelter (Apify actor → OSM fallback)
 *  - live public alerts & road closures (Bright Data Web Unlocker → direct fallback)
 * and writes them into incident.context so the coach can say
 * "there's an AED 40 metres away in the lobby" instead of "find an AED".
 */
export const enrichIncident = internalAction({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }): Promise<void> => {
    const inc: Doc<'incidents'> | null = await ctx.runQuery(internal.incidents.getInternal, { incidentId });
    if (!inc || inc.lat == null || inc.lng == null) return;
    const { lat, lng } = inc;

    const wantsAed = ['cardiac_arrest', 'opioid_overdose', 'unresponsive_breathing', 'choking_adult'].includes(inc.situation);
    const wantsShelter = ['flood', 'wildfire_smoke', 'earthquake', 'structure_fire'].includes(inc.situation);
    const kinds: Array<'aed' | 'shelter' | 'hospital' | 'fire_station'> = ['hospital'];
    if (wantsAed) kinds.unshift('aed');
    if (wantsShelter) kinds.push('shelter', 'fire_station');

    const [res, live] = await Promise.all([findNearbyResources(lat, lng, kinds), fetchLiveContext(lat, lng, inc.situation)]);

    if (res.items.length) {
      await ctx.runMutation(internal.incidents.addResources, { incidentId, items: res.items.slice(0, 20) });
    }

    const aeds = res.items.filter((r) => r.kind === 'aed').map((r) => ({ ...r, d: haversineM(lat, lng, r.lat, r.lng) })).sort((a, b) => a.d - b.d);
    const hospitals = res.items.filter((r) => r.kind === 'hospital').map((r) => ({ ...r, d: haversineM(lat, lng, r.lat, r.lng) })).sort((a, b) => a.d - b.d);

    await ctx.runMutation(internal.incidents.setContext, {
      incidentId,
      context: {
        nearestAed: aeds[0] ? `${aeds[0].name}, about ${Math.round(aeds[0].d / 10) * 10} metres away${aeds[0].address ? ` (${aeds[0].address})` : ''}` : undefined,
        hospitals: hospitals.slice(0, 3).map((h) => `${h.name} (${(h.d / 1000).toFixed(1)} km)`),
        liveAlerts: live.alerts.length ? live.alerts : undefined,
        roadClosures: live.roadClosures.length ? live.roadClosures : undefined,
      },
    });

    // If we found something the coach should mention proactively, interject once.
    if (aeds[0] && aeds[0].d < 300) {
      await ctx.scheduler.runAfter(0, internal.coach.interject, { incidentId, event: `[context: nearest AED found — ${aeds[0].name}, ${Math.round(aeds[0].d)} m away. Mention it briefly if someone can be sent.]` });
    } else if (live.alerts.length && wantsShelter) {
      await ctx.scheduler.runAfter(0, internal.coach.interject, { incidentId, event: `[context: live alert — ${live.alerts[0]}. Fold the relevant part into your next line.]` });
    }
  },
});
