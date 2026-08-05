/**
 * Psyche Protocol Lab — Hermes proxy
 * Cloudflare Worker. Holds the Nous Portal API key server-side so it never
 * reaches the browser, and puts guardrails on what visitors can spend.
 *
 * Setup:
 *   npx wrangler secret put NOUS_API_KEY
 *   npx wrangler deploy
 */

const UPSTREAM = 'https://inference-api.nousresearch.com/v1/chat/completions';

// Only these models may be requested through the proxy.
const ALLOWED_MODELS = new Set([
  'Hermes-4.3-36B',
  'Hermes-4-70B',
  'Hermes-4-405B',
]);

const MAX_TOKENS = 800;      // hard cap on completion length
const MAX_CHARS  = 12000;    // hard cap on inbound prompt size
const LIMIT      = 20;       // requests per IP per window
const WINDOW     = 3600;     // window, seconds

function cors(origin, allowed) {
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const head = cors(origin, allowed);

    if (request.method === 'OPTIONS') return new Response(null, { headers: head });
    if (request.method !== 'POST')    return json({ error: 'POST only' }, 405, head);

    if (allowed.length && !allowed.includes(origin))
      return json({ error: 'origin not allowed' }, 403, head);

    if (!env.NOUS_API_KEY)
      return json({ error: 'NOUS_API_KEY secret is not configured' }, 500, head);

    // ── rate limit (optional: bind a KV namespace named RATE_LIMIT) ──
    if (env.RATE_LIMIT) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const key = `rl:${ip}:${Math.floor(Date.now() / 1000 / WINDOW)}`;
      const used = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
      if (used >= LIMIT)
        return json({ error: `rate limit: ${LIMIT} requests/hour` }, 429, head);
      await env.RATE_LIMIT.put(key, String(used + 1), { expirationTtl: WINDOW });
    }

    // ── validate body ──
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'invalid JSON' }, 400, head); }

    const model = body.model;
    if (!ALLOWED_MODELS.has(model))
      return json({ error: `model not allowed: ${model}` }, 400, head);

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return json({ error: 'messages required' }, 400, head);

    const size = messages.reduce((n, m) => n + String(m.content || '').length, 0);
    if (size > MAX_CHARS)
      return json({ error: `prompt too large (${size} > ${MAX_CHARS} chars)` }, 413, head);

    // ── forward, with our own ceilings ──
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.NOUS_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: Math.min(Number(body.temperature ?? 0.3), 1),
        max_tokens: Math.min(Number(body.max_tokens ?? 700), MAX_TOKENS),
        stream: false,
      }),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...head },
    });
  },
};
