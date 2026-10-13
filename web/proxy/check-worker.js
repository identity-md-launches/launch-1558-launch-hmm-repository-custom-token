// A tiny Cloudflare Worker that lets the hmm site call the IMD swarm's free question checker from the browser.
//
// POST https://api.imd.fun/requests/check refuses requests that carry a foreign Origin (`origin_not_allowed`), so a
// static site cannot call it directly. This worker accepts the same JSON from the browser, forwards it from the
// server side with no Origin/Referer/cookies, and adds CORS headers to the answer.
//
// It only forwards `oracle.request` checks (it is not a general proxy) and caps the body size.
//
// Deploy:  npx wrangler deploy proxy/check-worker.js --name hmm-check --compatibility-date 2026-10-01
// Then build the site with  VITE_CHECK_URL=https://hmm-check.<your-subdomain>.workers.dev
// Optional env var ALLOWED_ORIGINS="https://your.site,https://<cid>.ipfs.dweb.link" (default "*").
// Add a Cloudflare rate-limiting rule on the route if you expect traffic; the upstream rate-limits too.

const UPSTREAM = 'https://api.imd.fun/requests/check'
const MAX_BYTES = 20_000

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

export default {
  async fetch(request, env) {
    const allowed = String(env?.ALLOWED_ORIGINS ?? '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const origin = request.headers.get('origin') ?? ''
    const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : ''
    const cors = {
      'access-control-allow-origin': allowOrigin || 'null',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    }

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors)
    if (!allowOrigin) return json({ error: 'origin_not_allowed' }, 403, cors)

    const text = await request.text()
    if (text.length > MAX_BYTES) return json({ error: 'too_large' }, 413, cors)
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return json({ error: 'invalid_json' }, 400, cors)
    }
    if (!body || body.action !== 'oracle.request' || typeof body.input !== 'object' || body.input === null) {
      return json({ error: 'invalid_request', detail: 'only oracle.request checks are forwarded' }, 400, cors)
    }

    let upstream
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ action: 'oracle.request', input: body.input }),
      })
    } catch {
      return json({ error: 'upstream_unreachable' }, 502, cors)
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  },
}
