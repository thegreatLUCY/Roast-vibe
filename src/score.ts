import type { Bucket, Finding, Tier } from './types';

export const BUCKET_CAPS: Record<Bucket, number> = {
  secrets: 50,    // catastrophic-class. Leaked creds alone should be able to tank a score.
  auth_db: 30,
  ai_slop: 20,
  classifier: 0,
  smell: 10,
};

export function calculateScore(findings: Finding[]): {
  score: number;
  tier: Tier;
  deductionsByBucket: Record<Bucket, number>;
} {
  const raw: Record<Bucket, number> = {
    secrets: 0,
    auth_db: 0,
    ai_slop: 0,
    classifier: 0,
    smell: 0,
  };
  for (const f of findings) raw[f.bucket] += f.points;

  const deductionsByBucket: Record<Bucket, number> = {
    secrets: Math.min(raw.secrets, BUCKET_CAPS.secrets),
    auth_db: Math.min(raw.auth_db, BUCKET_CAPS.auth_db),
    ai_slop: Math.min(raw.ai_slop, BUCKET_CAPS.ai_slop),
    classifier: 0,
    smell: Math.min(raw.smell, BUCKET_CAPS.smell),
  };

  const total = Object.values(deductionsByBucket).reduce((a, b) => a + b, 0);
  const score = Math.max(0, Math.min(100, 100 - total));
  const tier: Tier = scoreToTier(score);

  return { score, tier, deductionsByBucket };
}

export function scoreToTier(score: number): Tier {
  if (score <= 25) return 'catastrophic';
  if (score <= 50) return 'vibe_coder_special';
  if (score <= 75) return 'surprisingly_functional';
  return 'production_adjacent';
}

export function tierLabel(tier: Tier): string {
  switch (tier) {
    case 'catastrophic': return 'CATASTROPHIC';
    case 'vibe_coder_special': return 'VIBE-CODER SPECIAL';
    case 'surprisingly_functional': return 'SURPRISINGLY FUNCTIONAL';
    case 'production_adjacent': return 'PRODUCTION-ADJACENT';
  }
}
