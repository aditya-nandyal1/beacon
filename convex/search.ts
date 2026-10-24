'use node';

import { v } from 'convex/values';
import { action } from './_generated/server';
import { searchIncidents } from './lib/elastic';

/** Ops dashboard search over indexed incidents + after-action reports (Elastic). */
export const incidents = action({
  args: { query: v.string() },
  handler: async (_ctx, { query }) => searchIncidents(query, 20),
});
