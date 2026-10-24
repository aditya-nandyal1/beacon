import Anthropic from '@anthropic-ai/sdk';

/**
 * Model router.
 *
 * Primary: Anthropic (Claude) — vision triage + coaching.
 * Fallback: Bitdeer AI Model Studio (OpenAI-compatible endpoint) — used when the
 * primary errors, times out, or is rate-limited. Emergencies cannot wait on a
 * single vendor's status page.
 *
 * Both paths return raw text; callers parse/validate with zod and retry once
 * with a "fix the JSON" nudge if parsing fails.
 */

export interface ModelEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_FAST_MODEL?: string;
  BITDEER_API_KEY?: string;
  BITDEER_BASE_URL?: string;
  BITDEER_MODEL?: string;
}

export interface ImageInput {
  /** base64 without the data: prefix */
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface CompleteOptions {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; image?: ImageInput }>;
  maxTokens?: number;
  temperature?: number;
  /** 'fast' selects the cheaper model for re-checks. */
  tier?: 'main' | 'fast';
  timeoutMs?: number;
}

export interface CompleteResult {
  text: string;
  provider: 'anthropic' | 'bitdeer' | 'local';
  model: string;
  latencyMs: number;
}

export class ModelRouter {
  private anthropic: Anthropic | null;
  constructor(private env: ModelEnv) {
    this.anthropic = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
  }

  get hasAnyProvider(): boolean {
    return Boolean(this.anthropic || this.env.BITDEER_API_KEY);
  }

  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    const timeoutMs = opts.timeoutMs ?? 12_000;
    const errors: string[] = [];

    if (this.anthropic) {
      try {
        return await withTimeout(this.completeAnthropic(opts), timeoutMs, 'anthropic');
      } catch (e) {
        errors.push(`anthropic: ${(e as Error).message}`);
      }
    }
    if (this.env.BITDEER_API_KEY) {
      try {
        return await withTimeout(this.completeBitdeer(opts), timeoutMs, 'bitdeer');
      } catch (e) {
        errors.push(`bitdeer: ${(e as Error).message}`);
      }
    }
    throw new Error(`All model providers failed: ${errors.join('; ') || 'no provider configured'}`);
  }

  private async completeAnthropic(opts: CompleteOptions): Promise<CompleteResult> {
    const model =
      opts.tier === 'fast'
        ? this.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5'
        : this.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
    const t0 = Date.now();
    const res = await this.anthropic!.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 800,
      temperature: opts.temperature ?? 0.2,
      system: opts.system,
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.image
          ? [
              { type: 'image' as const, source: { type: 'base64' as const, media_type: m.image.mediaType, data: m.image.base64 } },
              { type: 'text' as const, text: m.content },
            ]
          : m.content,
      })),
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text, provider: 'anthropic', model, latencyMs: Date.now() - t0 };
  }

  private async completeBitdeer(opts: CompleteOptions): Promise<CompleteResult> {
    const base = (this.env.BITDEER_BASE_URL || 'https://api-inference.bitdeer.ai/v1').replace(/\/$/, '');
    const model = this.env.BITDEER_MODEL || 'default';
    const t0 = Date.now();
    const body = {
      model,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 800,
      messages: [
        { role: 'system', content: opts.system },
        ...opts.messages.map((m) =>
          m.image
            ? {
                role: m.role,
                content: [
                  { type: 'image_url', image_url: { url: `data:${m.image.mediaType};base64,${m.image.base64}` } },
                  { type: 'text', text: m.content },
                ],
              }
            : { role: m.role, content: m.content },
        ),
      ],
    };
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.env.BITDEER_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
    const json = (await r.json()) as { choices: Array<{ message: { content: string } }> };
    return { text: json.choices[0]?.message?.content ?? '', provider: 'bitdeer', model, latencyMs: Date.now() - t0 };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

/** Extract the first top-level JSON object from a model reply (tolerates code fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model output');
  return JSON.parse(candidate.slice(start, end + 1));
}
