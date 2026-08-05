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
const LIMIT      = 8;        // requests per IP per window
const WINDOW     = 3600;     // window, seconds
const DAILY      = 200;      // total requests per day across ALL visitors (your wallet's ceiling)

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

    // ── spend controls ──
    // Without a KV binding there is NO rate limit and NO budget ceiling, which means
    // anyone who finds this URL can burn your credit. Refuse to serve in that case.
    if (!env.RATE_LIMIT)
      return json({ error: 'budget_exhausted', detail: 'proxy misconfigured: RATE_LIMIT KV not bound' }, 429, head);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // per-IP hourly limit
    const ipKey = `rl:${ip}:${Math.floor(Date.now() / 1000 / WINDOW)}`;
    const ipUsed = parseInt((await env.RATE_LIMIT.get(ipKey)) || '0', 10);
    if (ipUsed >= LIMIT)
      return json({ error: 'rate_limited', detail: `${LIMIT} requests/hour per IP` }, 429, head);

    // global daily budget — the hard ceiling on what this demo can cost you
    const cap = parseInt(env.DAILY_BUDGET || DAILY, 10);
    const dayKey = `day:${new Date().toISOString().slice(0, 10)}`;
    const dayUsed = parseInt((await env.RATE_LIMIT.get(dayKey)) || '0', 10);
    if (dayUsed >= cap)
      return json({ error: 'budget_exhausted', detail: `daily demo budget of ${cap} requests reached` }, 429, head);

    await env.RATE_LIMIT.put(ipKey, String(ipUsed + 1), { expirationTtl: WINDOW });
    await env.RATE_LIMIT.put(dayKey, String(dayUsed + 1), { expirationTtl: 172800 });

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
