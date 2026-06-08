import { Hono } from 'hono';
import type { Env, ScanResult } from './types';
import { parseRepoUrl, fetchRepoMeta } from './github';
import { checkRateLimits, getIp } from './ratelimit';
import { errorFromCode } from './errors';

export { ScanRunner } from './do/ScanRunner';

const app = new Hono<{ Bindings: Env }>();

// ─── API ─────────────────────────────────────────────

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/scan', async (c) => {
  let body: { url?: string } = {};
  try { body = await c.req.json(); } catch { /* empty */ }
  const input = body.url ?? c.req.query('url') ?? '';
  if (!input) {
    const p = errorFromCode('MISSING_URL');
    return c.json(p, p.status as 400);
  }

  const parsed = parseRepoUrl(input);
  if (!parsed) {
    const p = errorFromCode('BAD_URL');
    return c.json(p, p.status as 400);
  }

  // Rate limit (per-IP + global daily quotas)
  const ip = getIp(c.req.raw);
  const rl = await checkRateLimits(c.env, ip);
  if (!rl.ok) {
    const p = errorFromCode(rl.reason === 'global_quota' ? 'RATE_LIMIT_GLOBAL' : 'RATE_LIMIT_IP');
    return c.json(p, p.status as 429);
  }

  // Resolve repo meta up front so the DO can be keyed by commit SHA.
  // This makes new commits produce a new DO (no stale cached results).
  let meta;
  try {
    meta = await fetchRepoMeta(parsed.owner, parsed.name, c.env.GITHUB_PAT);
  } catch (e: any) {
    const p = errorFromCode('SCAN_FAILED', String(e?.message ?? e));
    return c.json(p, p.status as 500);
  }

  const sha = meta.sha.toLowerCase();
  const doName = `${parsed.owner}/${parsed.name}@${sha}`.toLowerCase();
  const id = c.env.SCAN_RUNNER.idFromName(doName);
  const stub = c.env.SCAN_RUNNER.get(id);

  try {
    const r = await stub.fetch('https://do/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...parsed, meta }),
    });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    const p = errorFromCode('SCAN_FAILED', String(e?.message ?? e));
    return c.json(p, p.status as 500);
  }
});

app.get('/api/result/:id', async (c) => {
  const id = c.req.param('id');
  const stub = stubFromScanId(c.env, id);
  if (!stub) return c.json({ error: 'BAD_ID', message: 'That scan ID is malformed.' }, 400);
  if (await isReported(c.env, id)) {
    return c.json({ error: 'REPORTED', message: 'This roast has been pulled.' }, 410);
  }
  const r = await stub.fetch('https://do/result');
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
});

app.get('/api/card/:id/:file', async (c) => {
  const id = c.req.param('id');
  const file = c.req.param('file');
  const m = file.match(/^(full|score_only)\.png$/);
  if (!m) return c.text('bad variant', 400);
  const variant = m[1] as 'full' | 'score_only';
  const stub = stubFromScanId(c.env, id);
  if (!stub) return c.text('bad id', 400);
  if (await isReported(c.env, id)) return c.text('this roast has been pulled', 410);
  return stub.fetch(`https://do/card?variant=${variant}`);
});

app.post('/api/report', async (c) => {
  let body: { scanId?: string; reason?: string } = {};
  try { body = await c.req.json(); } catch { /* empty */ }
  const scanId = (body.scanId ?? '').trim().slice(0, 128);
  const reason = (body.reason ?? '').trim().slice(0, 500) || null;
  if (!scanId) return c.json({ error: 'MISSING_SCAN_ID' }, 400);

  const ip = getIp(c.req.raw);
  try {
    await c.env.DB.prepare(
      `INSERT INTO reports (scan_id, reported_at, reason, ip) VALUES (?, ?, ?, ?)`,
    )
      .bind(scanId, Date.now(), reason, ip)
      .run();
  } catch (e: any) {
    return c.json({ error: 'DB_ERROR', message: String(e?.message ?? e) }, 500);
  }
  return c.json({ ok: true });
});

async function isReported(env: Env, scanId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM reports WHERE scan_id = ? LIMIT 1`,
  )
    .bind(scanId)
    .first<{ '1': number }>();
  return !!row;
}

app.post('/api/newsletter', async (c) => {
  let body: { email?: string; handle?: string; scanId?: string } = {};
  try { body = await c.req.json(); } catch { /* empty */ }
  const email = (body.email ?? '').trim().toLowerCase();
  const handle = (body.handle ?? '').trim().slice(0, 64) || null;
  const scanId = (body.scanId ?? '').trim().slice(0, 128) || null;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
    return c.json({ error: 'BAD_EMAIL' }, 400);
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO newsletter_signups (email, handle, source_scan_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET handle = COALESCE(excluded.handle, handle), source_scan_id = COALESCE(excluded.source_scan_id, source_scan_id)`,
    )
      .bind(email, handle, scanId, Date.now())
      .run();
  } catch (e: any) {
    return c.json({ error: 'DB_ERROR', message: String(e?.message ?? e) }, 500);
  }

  return c.json({ ok: true });
});

// ─── /r/:id with OG meta injection ───────────────────

app.get('/r/:id', async (c) => {
  const id = c.req.param('id');
  const stub = stubFromScanId(c.env, id);

  const assetResp = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)));

  if (!stub) return assetResp;
  if (await isReported(c.env, id)) return assetResp; // shell renders; UI will show "pulled" via /api/result returning 410

  let result: ScanResult | null = null;
  try {
    const r = await stub.fetch('https://do/result');
    if (r.ok) result = await r.json();
  } catch { /* ignore */ }

  if (!result) return assetResp;

  const origin = new URL(c.req.url).origin;
  const cardUrl = `${origin}/api/card/${result.scanId}/full.png`;
  const pageUrl = `${origin}/r/${result.scanId}`;
  const title = `${result.repo} — ${result.score}/100 on roast.vibe`;
  const desc = result.roast.verdict.slice(0, 200);

  class Inject {
    element(el: any) {
      const meta = [
        `<title>${escapeHtml(title)}</title>`,
        `<meta name="description" content="${escapeHtml(desc)}" />`,
        `<meta property="og:title" content="${escapeHtml(title)}" />`,
        `<meta property="og:description" content="${escapeHtml(desc)}" />`,
        `<meta property="og:image" content="${cardUrl}" />`,
        `<meta property="og:url" content="${pageUrl}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:image" content="${cardUrl}" />`,
        `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
        `<meta name="twitter:description" content="${escapeHtml(desc)}" />`,
      ].join('\n');
      el.append(meta, { html: true });
    }
  }

  return new HTMLRewriter().on('head', new Inject()).transform(assetResp);
});

// ─── Helpers ─────────────────────────────────────────

function stubFromScanId(env: Env, id: string): DurableObjectStub | null {
  const parts = id.split('--');
  if (parts.length !== 3) return null;
  const [owner, name, sha] = parts;
  if (!owner || !name || !/^[a-f0-9]{40}$/i.test(sha)) return null;
  const doName = `${owner}/${name}@${sha}`.toLowerCase();
  const stubId = env.SCAN_RUNNER.idFromName(doName);
  return env.SCAN_RUNNER.get(stubId);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default app;
