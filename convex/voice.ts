'use node';

import { v } from 'convex/values';
import { action } from './_generated/server';

/**
 * Mint a short-lived Cartesia access token so the browser can open the TTS and
 * STT WebSockets directly (lowest latency) without ever seeing the API key.
 * https://docs.cartesia.ai/get-started/authenticate-your-client-applications
 */
export const cartesiaToken = action({
  args: { sessionId: v.string() },
  handler: async () => {
    const key = process.env.CARTESIA_API_KEY;
    if (!key) return { ok: false as const, reason: 'cartesia_not_configured' };
    const r = await fetch('https://api.cartesia.ai/access-token', {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Cartesia-Version': '2025-04-16', 'content-type': 'application/json' },
      body: JSON.stringify({ grants: { tts: true, stt: true }, expires_in: 300 }),
    });
    if (!r.ok) return { ok: false as const, reason: `cartesia_token_failed_${r.status}` };
    const json = (await r.json()) as { token: string };
    return {
      ok: true as const,
      token: json.token,
      expiresInSec: 300,
      voiceId: process.env.CARTESIA_VOICE_ID || null,
      ttsModel: process.env.CARTESIA_TTS_MODEL || 'sonic-2',
      sttModel: process.env.CARTESIA_STT_MODEL || 'ink-whisper',
    };
  },
});
