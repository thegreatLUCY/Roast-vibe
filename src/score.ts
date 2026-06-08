import { findingMeta } from './findingMeta';
import type { Bucket, Finding, ScannedRepo, ScoreDetails, Tier } from './types';

export const BUCKET_CAPS: Record<Bucket, number> = {
  secrets: 50,    // catastrophic-class. Leaked creds alone should be able to tank a score.
  auth_db: 30,
  ai_slop: 20,
  classifier: 0,
  smell: 5,
};

export function calculateScore(findings: Finding[]): {
  score: number;
  tier: Tier;
  deductionsByBucket: Record<Bucket, number>;
  scoreDetails: ScoreDetails;
};
export function calculateScore(findings: Finding[], repo: ScannedRepo): {
  score: number;
  tier: Tier;
  deductionsByBucket: Record<Bucket, number>;
  scoreDetails: ScoreDetails;
};
export function calculateScore(findings: Finding[], repo?: ScannedRepo): {
  score: number;
  tier: Tier;
  deductionsByBucket: Record<Bucket, number>;
  scoreDetails: ScoreDetails;
} {
  const enriched = findings.map(f => ({ ...f, ...findingMeta(f) }));
  const raw: Record<Bucket, number> = {
    secrets: 0,
    auth_db: 0,
    ai_slop: 0,
    classifier: 0,
    smell: 0,
  };
  for (const f of enriched) raw[f.bucket] += effectivePoints(f);

  const deductionsByBucket: Record<Bucket, number> = {
    secrets: Math.min(raw.secrets, BUCKET_CAPS.secrets),
    auth_db: Math.min(raw.auth_db, BUCKET_CAPS.auth_db),
    ai_slop: Math.min(raw.ai_slop, BUCKET_CAPS.ai_slop),
    classifier: 0,
    smell: Math.min(raw.smell, BUCKET_CAPS.smell),
  };

  const comboRules = comboPenalties(enriched);
  const comboTotal = comboRules.reduce((sum, c) => sum + c.points, 0);
  const total = Object.values(deductionsByBucket).reduce((a, b) => a + b, 0) + comboTotal;
  const productionSurface = repo ? hasProductionSurface(repo) : true;
  const ceilings = scoreCeilings(enriched);

  let score = Math.max(0, Math.min(100, 100 - total));
  if (!productionSurface) score = Math.max(score, 85);
  if (onlyVibeOrQuality(enriched)) score = Math.max(score, 75);
  if (onlyCosmeticOrLowConfidence(enriched)) score = Math.max(score, 85);
  for (const ceiling of ceilings) score = Math.min(score, ceiling.maxScore);

  const tier: Tier = scoreToTier(score);
  const scoreDetails: ScoreDetails = {
    productionSurface,
    riskScore: Math.max(0, 100 - deductionsByBucket.secrets - deductionsByBucket.auth_db - comboTotalForAxis(comboRules, 'risk')),
    vibeScore: Math.max(0, 100 - deductionsByBucket.ai_slop - comboTotalForAxis(comboRules, 'vibe')),
    qualityScore: Math.max(0, 100 - deductionsByBucket.smell),
    confidenceCounts: confidenceCounts(enriched),
    appliedCeilings: ceilings,
    comboRules,
  };

  return { score, tier, deductionsByBucket, scoreDetails };
}

export function scoreToTier(score: number): Tier {
  if (score <= 25) return 'catastrophic';
  if (score <= 50) return 'vibe_coder_special';
  if (score <= 75) return 'surprisingly_functional';
  if (score <= 89) return 'production_adjacent';
  return 'suspiciously_clean';
}

function effectivePoints(finding: Finding): number {
  const meta = findingMeta(finding);
  if (finding.bucket === 'classifier') return 0;
  if (meta.confidence === 'low') return 0;
  if (meta.confidence === 'medium') return Math.ceil(finding.points * 0.85);
  return finding.points;
}

function comboPenalties(findings: Finding[]): ScoreDetails['comboRules'] {
  const rules = new Set(findings.map(f => f.ruleId));
  const combos: ScoreDetails['comboRules'] = [];
  const count = (ruleId: string) => findings.filter(f => f.ruleId === ruleId).length;

  if (rules.has('secrets.supabase_service_role') && rules.has('authdb.supabase_no_migrations')) {
    combos.push({
      id: 'combo.supabase_service_role_no_rls',
      points: 10,
      reason: 'Supabase service_role exposure combined with missing RLS migrations',
    });
  }
  if (rules.has('secrets.env_committed') && rules.has('authdb.supabase_no_migrations')) {
    combos.push({
      id: 'combo.committed_env_supabase_no_migrations',
      points: 6,
      reason: 'Committed env file combined with Supabase usage and no RLS migrations',
    });
  }
  if (rules.has('authdb.client_only_auth') && rules.has('authdb.api_route_no_auth')) {
    combos.push({
      id: 'combo.client_only_auth_api_no_auth',
      points: 8,
      reason: 'Client-only route protection paired with an unauthenticated API route',
    });
  }
  if (rules.has('aislop.mock_data_in_render') && rules.has('aislop.todo_auth') && hasDefaultTitle(findings)) {
    combos.push({
      id: 'combo.fake_saas_scaffold',
      points: 4,
      reason: 'Mock rendered data, TODO auth, and default app title appear together',
    });
  }
  if (rules.has('aislop.hardcoded_production_data') && rules.has('aislop.frontend_only_commerce_flow')) {
    combos.push({
      id: 'combo.frontend_only_fake_commerce',
      points: 5,
      reason: 'Production-looking commerce UI uses hardcoded data and completes orders in frontend code',
    });
  }
  if (rules.has('aislop.localstorage_database') && rules.has('authdb.client_only_auth')) {
    combos.push({
      id: 'combo.browser_only_fake_backend',
      points: 6,
      reason: 'Protected-looking app stores business data and auth state only in browser storage',
    });
  }
  if (rules.has('secrets.env_secret_fallback') && rules.has('authdb.api_route_no_auth')) {
    combos.push({
      id: 'combo.env_fallback_unauth_api',
      points: 5,
      reason: 'Unauthenticated API route sits next to hardcoded secret fallback config',
    });
  }
  if (count('authdb.api_route_no_auth') >= 4) {
    combos.push({
      id: 'combo.repeated_unauthenticated_data_apis',
      points: 8,
      reason: 'Multiple data API routes touch storage without server-side auth',
    });
  }

  return combos;
}

function scoreCeilings(findings: Finding[]): ScoreDetails['appliedCeilings'] {
  const ceilings: ScoreDetails['appliedCeilings'] = [];
  const has = (ruleId: string) => findings.some(f => f.ruleId === ruleId);

  if (has('secrets.supabase_service_role')) {
    ceilings.push({ ruleId: 'secrets.supabase_service_role', maxScore: 25, reason: 'Supabase service_role JWT exposed' });
  }
  const realEnvCommitted = findings.some(f => f.ruleId === 'secrets.env_committed' && f.severity === 'catastrophic');
  if (realEnvCommitted) {
    ceilings.push({ ruleId: 'secrets.env_committed', maxScore: 50, reason: 'Real-looking .env file committed to the repository' });
  }
  if (realEnvCommitted && has('authdb.supabase_no_migrations')) {
    ceilings.push({ ruleId: 'combo.committed_env_supabase_no_migrations', maxScore: 45, reason: 'Committed env file combined with Supabase usage and no RLS migrations' });
  }
  if (has('secrets.env_secret_fallback')) {
    ceilings.push({ ruleId: 'secrets.env_secret_fallback', maxScore: 80, reason: 'Secret env var has a hardcoded fallback literal' });
  }
  for (const f of findings) {
    if (isClientReachableSecret(f)) {
      ceilings.push({ ruleId: f.ruleId, maxScore: 35, reason: 'Real secret appears in client-reachable code' });
    }
  }
  if (has('authdb.api_route_no_auth')) {
    ceilings.push({ ruleId: 'authdb.api_route_no_auth', maxScore: 55, reason: 'API route touches data without server-side auth' });
  }
  const unauthApiCount = findings.filter(f => f.ruleId === 'authdb.api_route_no_auth').length;
  if (unauthApiCount >= 4) {
    ceilings.push({ ruleId: 'combo.repeated_unauthenticated_data_apis', maxScore: 40, reason: `${unauthApiCount} API routes touch data without server-side auth` });
  } else if (unauthApiCount >= 2) {
    ceilings.push({ ruleId: 'combo.multiple_unauthenticated_data_apis', maxScore: 45, reason: `${unauthApiCount} API routes touch data without server-side auth` });
  }
  if (has('authdb.sql_interpolation')) {
    ceilings.push({ ruleId: 'authdb.sql_interpolation', maxScore: 55, reason: 'SQL injection-shaped query construction' });
  }
  if (findings.some(f => f.ruleId === 'authdb.cors_wildcard' && isServerOrApiEvidence(f))) {
    ceilings.push({ ruleId: 'authdb.cors_wildcard', maxScore: 89, reason: 'CORS wildcard appears on a real server/API surface' });
  }
  if (has('authdb.client_only_auth')) {
    ceilings.push({ ruleId: 'authdb.client_only_auth', maxScore: 75, reason: 'Protected route appears enforced only in browser code' });
  }
  if (has('aislop.localstorage_database')) {
    ceilings.push({ ruleId: 'aislop.localstorage_database', maxScore: 80, reason: 'Business data appears persisted only in browser storage' });
  }
  if (has('aislop.frontend_only_commerce_flow')) {
    ceilings.push({ ruleId: 'aislop.frontend_only_commerce_flow', maxScore: 85, reason: 'Checkout/order/payment flow appears to complete only in frontend code' });
  }
  if (has('aislop.hardcoded_production_data') && has('aislop.frontend_only_commerce_flow')) {
    ceilings.push({ ruleId: 'combo.frontend_only_fake_commerce', maxScore: 75, reason: 'Production-looking commerce UI uses hardcoded data and completes orders in frontend code' });
  }
  if (has('aislop.localstorage_database') && has('authdb.client_only_auth')) {
    ceilings.push({ ruleId: 'combo.browser_only_fake_backend', maxScore: 50, reason: 'Protected app stores auth and business data only in browser storage' });
  }

  return dedupeCeilings(ceilings);
}

function isClientReachableSecret(finding: Finding): boolean {
  if (finding.bucket !== 'secrets') return false;
  if (finding.ruleId === 'secrets.env_committed') return false;
  const file = finding.evidence.file ?? '';
  return file.startsWith('src/')
    || file.startsWith('app/')
    || file.startsWith('pages/')
    || file.startsWith('components/')
    || file.startsWith('public/');
}

function isServerOrApiEvidence(finding: Finding): boolean {
  const file = finding.evidence.file ?? '';
  return file.startsWith('app/api/')
    || file.startsWith('pages/api/')
    || file.startsWith('api/')
    || file.startsWith('server/')
    || file.startsWith('src/server/')
    || file.startsWith('supabase/functions/')
    || /(^|\/)(server|worker|app|index)\.(ts|js|mjs)$/.test(file)
    || /(^|\/)api-server\//.test(file);
}

function dedupeCeilings(ceilings: ScoreDetails['appliedCeilings']): ScoreDetails['appliedCeilings'] {
  const seen = new Set<string>();
  const out: ScoreDetails['appliedCeilings'] = [];
  for (const c of ceilings.sort((a, b) => a.maxScore - b.maxScore)) {
    const key = `${c.ruleId}:${c.maxScore}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function onlyVibeOrQuality(findings: Finding[]): boolean {
  return findings.length > 0 && findings.every(f => {
    const axis = findingMeta(f).axis;
    return axis === 'vibe' || axis === 'quality' || axis === 'classifier';
  });
}

function onlyCosmeticOrLowConfidence(findings: Finding[]): boolean {
  return findings.length > 0 && findings.every(f => {
    const meta = findingMeta(f);
    return f.severity === 'cosmetic' || meta.confidence === 'low' || meta.axis === 'classifier';
  });
}

function hasDefaultTitle(findings: Finding[]): boolean {
  return findings.some(f => f.ruleId.startsWith('aislop.default_title_'));
}

function comboTotalForAxis(combos: ScoreDetails['comboRules'], axis: 'risk' | 'vibe'): number {
  return combos
    .filter(c => axis === 'risk'
      ? c.id.includes('auth') || c.id.includes('supabase') || c.id.includes('unauth') || c.id.includes('env')
      : c.id.includes('fake_saas') || c.id.includes('fake_commerce') || c.id.includes('fake_backend'))
    .reduce((sum, c) => sum + c.points, 0);
}

function confidenceCounts(findings: Finding[]): ScoreDetails['confidenceCounts'] {
  const counts: ScoreDetails['confidenceCounts'] = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[findingMeta(f).confidence] += 1;
  return counts;
}

function hasProductionSurface(repo: ScannedRepo): boolean {
  const deps = {
    ...(repo.packageJson?.dependencies ?? {}),
    ...(repo.packageJson?.devDependencies ?? {}),
  };
  const depNames = Object.keys(deps);
  if (depNames.some(d =>
    d.includes('supabase')
    || d.includes('prisma')
    || d.includes('drizzle')
    || d.includes('stripe')
    || d.includes('auth')
    || d === 'next'
    || d === 'hono'
    || d === 'express'
  )) return true;

  return repo.allPaths.some(p =>
    /^app\/.+\/route\./.test(p)
    || /^pages\/api\//.test(p)
    || /^server\//.test(p)
    || /^api\//.test(p)
    || /^supabase\//.test(p)
    || /^wrangler\.jsonc?$/.test(p)
    || /^\.github\/workflows\//.test(p)
    || /(^|\/)(dashboard|admin|account|settings|profile|billing|checkout|cart|orders|customers|users|patients|clients|reservations|bookings)(\/|\.|-)/i.test(p)
    || /(^|\/)(Dashboard|Admin|Account|Settings|Profile|Billing|Checkout|Cart|Orders|Customers|Users|Patients|Clients|Reservations|Bookings)[A-Z][\w-]*\.(tsx|jsx|ts|js)$/i.test(p)
  );
}

export function tierLabel(tier: Tier): string {
  switch (tier) {
    case 'catastrophic': return 'CATASTROPHIC';
    case 'vibe_coder_special': return 'VIBE-CODER SPECIAL';
    case 'surprisingly_functional': return 'SURPRISINGLY FUNCTIONAL';
    case 'production_adjacent': return 'PRODUCTION-ADJACENT';
    case 'suspiciously_clean': return 'SUSPICIOUSLY CLEAN';
  }
}
