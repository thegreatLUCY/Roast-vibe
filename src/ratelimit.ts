import type { Env } from './types';

export interface RateLimitResult {
  ok: boolean;
  reason?: 'ip_quota' | 'global_quota';
  ipCount?: number;
  ipLimit?: number;
  globalCount?: number;
  globalLimit?: number;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Check-and-increment for per-IP and global daily counters.
 * Uses two-statement form (upsert then select) for D1 portability.
 */
export async function checkRateLimits(env: Env, ip: string): Promise<RateLimitResult> {
  const day = todayUtc();
  const ipLimit = Number(env.RATE_LIMIT_PER_IP_PER_DAY) || 10;
  const globalLimit = Number(env.RATE_LIMIT_GLOBAL_PER_DAY) || 500;
  const ipKey = ip.toLowerCase().slice(0, 64);

  // Global counter: upsert + read
  await env.DB.prepare(
    `INSERT INTO rate_limits_global (day, count) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET count = count + 1`,
  )
    .bind(day)
    .run();
  const globalRow = await env.DB.prepare(
    `SELECT count FROM rate_limits_global WHERE day = ?`,
  )
    .bind(day)
    .first<{ count: number }>();
  const globalCount = globalRow?.count ?? 0;

  if (globalCount > globalLimit) {
    return { ok: false, reason: 'global_quota', globalCount, globalLimit };
  }

  // Per-IP counter
  await env.DB.prepare(
    `INSERT INTO rate_limits_ip (ip, day, count) VALUES (?, ?, 1)
     ON CONFLICT(ip, day) DO UPDATE SET count = count + 1`,
  )
    .bind(ipKey, day)
    .run();
  const ipRow = await env.DB.prepare(
    `SELECT count FROM rate_limits_ip WHERE ip = ? AND day = ?`,
  )
    .bind(ipKey, day)
    .first<{ count: number }>();
  const ipCount = ipRow?.count ?? 0;

  if (ipCount > ipLimit) {
    return { ok: false, reason: 'ip_quota', ipCount, ipLimit, globalCount, globalLimit };
  }

  return { ok: true, ipCount, ipLimit, globalCount, globalLimit };
}

export function getIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ??
    req.headers.get('X-Forwarded-For')?.split(',')[0].trim() ??
    'unknown'
  );
}
