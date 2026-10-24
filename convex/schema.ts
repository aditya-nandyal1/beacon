import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Beacon data model (Convex).
 *
 * Privacy by construction: camera frames are NEVER stored. Only the structured
 * assessment (what the model concluded) is persisted, and it contains no pixels.
 */

export const incidentStatus = v.union(v.literal('open'), v.literal('resolved'), v.literal('cancelled'));
export const severity = v.union(v.literal('none'), v.literal('low'), v.literal('moderate'), v.literal('high'), v.literal('critical'));

export default defineSchema({
  incidents: defineTable({
    sessionId: v.string(),
    status: incidentStatus,
    situation: v.string(),
    protocolId: v.union(v.string(), v.null()),
    stepId: v.union(v.string(), v.null()),
    severity,
    summary: v.string(),
    openedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolution: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    locationText: v.optional(v.string()),
    calledEmergency: v.boolean(),
    calledAt: v.optional(v.number()),
    helpersRequested: v.boolean(),
    /** Latest full SceneAssessment (schema enforced in packages/agent). */
    assessment: v.optional(v.any()),
    context: v.optional(
      v.object({
        nearestAed: v.optional(v.string()),
        liveAlerts: v.optional(v.array(v.string())),
        roadClosures: v.optional(v.array(v.string())),
        hospitals: v.optional(v.array(v.string())),
      }),
    ),
    turns: v.number(),
  })
    .index('by_session', ['sessionId'])
    .index('by_status', ['status', 'openedAt']),

  observations: defineTable({
    sessionId: v.string(),
    incidentId: v.optional(v.id('incidents')),
    at: v.number(),
    situation: v.string(),
    confidence: v.number(),
    severity,
    assessment: v.any(),
    provider: v.string(),
    model: v.string(),
    latencyMs: v.number(),
  })
    .index('by_session', ['sessionId', 'at'])
    .index('by_incident', ['incidentId', 'at']),

  messages: defineTable({
    incidentId: v.id('incidents'),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
    content: v.string(),
    at: v.number(),
    /** Author sessionId for multi-party incidents (helpers can talk too). */
    sessionId: v.optional(v.string()),
    turn: v.optional(v.any()),
  }).index('by_incident', ['incidentId', 'at']),

  helpers: defineTable({
    sessionId: v.string(),
    name: v.string(),
    skills: v.array(v.string()),
    lat: v.number(),
    lng: v.number(),
    available: v.boolean(),
    lastSeen: v.number(),
    /** Optional Fetch.ai agent address if this helper runs a personal agent. */
    agentAddress: v.optional(v.string()),
  }).index('by_session', ['sessionId']),

  helperResponses: defineTable({
    incidentId: v.id('incidents'),
    helperSessionId: v.string(),
    helperName: v.string(),
    status: v.union(v.literal('notified'), v.literal('accepted'), v.literal('declined'), v.literal('arrived')),
    distanceM: v.number(),
    etaSec: v.optional(v.number()),
    at: v.number(),
  })
    .index('by_incident', ['incidentId'])
    .index('by_helper', ['helperSessionId', 'at']),

  alerts: defineTable({
    incidentId: v.id('incidents'),
    channel: v.union(
      v.literal('sms'),
      v.literal('dispatch_webhook'),
      v.literal('fetchai'),
      v.literal('jira'),
      v.literal('elastic'),
      v.literal('droid'),
    ),
    status: v.union(v.literal('queued'), v.literal('sent'), v.literal('failed'), v.literal('skipped')),
    payload: v.any(),
    at: v.number(),
    error: v.optional(v.string()),
    externalId: v.optional(v.string()),
  }).index('by_incident', ['incidentId', 'at']),

  resources: defineTable({
    incidentId: v.optional(v.id('incidents')),
    kind: v.union(v.literal('aed'), v.literal('shelter'), v.literal('hospital'), v.literal('fire_station')),
    name: v.string(),
    lat: v.number(),
    lng: v.number(),
    address: v.optional(v.string()),
    source: v.string(),
    fetchedAt: v.number(),
  }).index('by_incident', ['incidentId']),

  afterActionReports: defineTable({
    incidentId: v.id('incidents'),
    status: v.union(v.literal('requested'), v.literal('generating'), v.literal('ready'), v.literal('failed')),
    markdown: v.optional(v.string()),
    jiraKey: v.optional(v.string()),
    jiraUrl: v.optional(v.string()),
    /** Droid's visible plan/steps so judges (and users) can see what the agent did. */
    agentTrace: v.optional(v.array(v.object({ at: v.number(), kind: v.string(), text: v.string() }))),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_incident', ['incidentId']),

  emergencyContacts: defineTable({
    sessionId: v.string(),
    name: v.string(),
    phone: v.string(),
  }).index('by_session', ['sessionId']),
});
