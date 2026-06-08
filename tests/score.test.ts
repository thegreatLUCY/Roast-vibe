import { describe, expect, it } from 'vitest';
import { BUCKET_CAPS, calculateScore, scoreToTier } from '../src/score';
import type { Bucket, Finding } from '../src/types';

function finding(bucket: Bucket, points: number, ruleId = `test.${bucket}.${points}`): Finding {
  return {
    ruleId,
    bucket,
    severity: 'smell',
    points,
    title: `${bucket} finding`,
    evidence: {},
  };
}

describe('calculateScore', () => {
  it('returns a perfect suspiciously clean score when there are no findings', () => {
    const result = calculateScore([]);

    expect(result.score).toBe(100);
    expect(result.tier).toBe('suspiciously_clean');
    expect(result.deductionsByBucket).toEqual({
      secrets: 0,
      auth_db: 0,
      ai_slop: 0,
      classifier: 0,
      smell: 0,
    });
  });

  it('applies the current bucket caps before subtracting from 100', () => {
    expect(BUCKET_CAPS).toEqual({
      secrets: 50,
      auth_db: 30,
      ai_slop: 20,
      classifier: 0,
      smell: 5,
    });

    const result = calculateScore([
      finding('secrets', 20, 'secrets.openai_key'),
      finding('secrets', 40, 'secrets.stripe_live_key'),
      finding('auth_db', 12, 'authdb.sql_interpolation'),
      finding('auth_db', 20, 'authdb.api_route_no_auth'),
      finding('ai_slop', 9, 'aislop.mock_data_in_render'),
      finding('ai_slop', 30, 'aislop.todo_auth'),
      finding('smell', 6, 'smell.multi_state_libs'),
      finding('smell', 9, 'smell.multi_state_libs'),
    ]);

    expect(result.deductionsByBucket).toEqual({
      secrets: 50,
      auth_db: 30,
      ai_slop: 20,
      classifier: 0,
      smell: 5,
    });
    expect(result.score).toBe(0);
    expect(result.tier).toBe('catastrophic');
    expect(result.scoreDetails.riskScore).toBeLessThan(100);
    expect(result.scoreDetails.vibeScore).toBeLessThan(100);
    expect(result.scoreDetails.qualityScore).toBe(95);
  });

  it('never lets classifier findings affect the score', () => {
    const result = calculateScore([
      finding('classifier', 100),
      finding('classifier', 100),
    ]);

    expect(result.deductionsByBucket.classifier).toBe(0);
    expect(result.score).toBe(100);
    expect(result.tier).toBe('suspiciously_clean');
  });

  it('discounts medium confidence findings and ignores low-confidence findings for score', () => {
    const result = calculateScore([
      finding('secrets', 18, 'secrets.google_api_key'),
      finding('auth_db', 8, 'authdb.supabase_no_migrations'),
      finding('ai_slop', 3, 'aislop.todo_auth'),
      finding('smell', 2, 'smell.async_no_try'),
    ]);

    expect(result.deductionsByBucket).toEqual({
      secrets: 16,
      auth_db: 7,
      ai_slop: 3,
      classifier: 0,
      smell: 0,
    });
    expect(result.score).toBe(74);
    expect(result.tier).toBe('surprisingly_functional');
    expect(result.scoreDetails.confidenceCounts).toEqual({ high: 0, medium: 3, low: 1 });
  });

  it('applies score ceilings for production catastrophes', () => {
    const result = calculateScore([
      {
        ...finding('secrets', 20, 'secrets.supabase_service_role'),
        severity: 'catastrophic',
        evidence: { file: 'src/integrations/supabase/client.ts' },
      },
    ]);

    expect(result.score).toBe(25);
    expect(result.tier).toBe('catastrophic');
    expect(result.scoreDetails.appliedCeilings.map(c => c.ruleId)).toContain('secrets.supabase_service_role');
  });

  it('caps real-looking committed env files at vibe-coder special', () => {
    const result = calculateScore([
      {
        ...finding('secrets', 18, 'secrets.env_committed'),
        severity: 'catastrophic',
        evidence: { file: '.env' },
      },
    ]);

    expect(result.score).toBe(50);
    expect(result.tier).toBe('vibe_coder_special');
    expect(result.scoreDetails.appliedCeilings.map(c => c.ruleId)).toContain('secrets.env_committed');
  });

  it('gets harsher when a committed env file appears in a Supabase app without migrations', () => {
    const result = calculateScore([
      {
        ...finding('secrets', 18, 'secrets.env_committed'),
        severity: 'catastrophic',
        evidence: { file: '.env' },
      },
      finding('auth_db', 8, 'authdb.supabase_no_migrations'),
    ]);

    expect(result.score).toBe(45);
    expect(result.tier).toBe('vibe_coder_special');
    expect(result.scoreDetails.comboRules.map(c => c.id)).toContain('combo.committed_env_supabase_no_migrations');
    expect(result.scoreDetails.appliedCeilings.map(c => c.ruleId)).toContain('combo.committed_env_supabase_no_migrations');
  });

  it('caps repeated unauthenticated data APIs as architecture failure, not one-off route risk', () => {
    const result = calculateScore([
      finding('auth_db', 10, 'authdb.api_route_no_auth'),
      finding('auth_db', 10, 'authdb.api_route_no_auth'),
      finding('auth_db', 10, 'authdb.api_route_no_auth'),
      finding('auth_db', 10, 'authdb.api_route_no_auth'),
    ]);

    expect(result.score).toBe(40);
    expect(result.tier).toBe('vibe_coder_special');
    expect(result.scoreDetails.comboRules.map(c => c.id)).toContain('combo.repeated_unauthenticated_data_apis');
    expect(result.scoreDetails.appliedCeilings.map(c => c.ruleId)).toContain('combo.repeated_unauthenticated_data_apis');
  });

  it('keeps real API CORS wildcard out of suspiciously-clean', () => {
    const result = calculateScore([
      {
        ...finding('auth_db', 6, 'authdb.cors_wildcard'),
        evidence: { file: 'server/app.ts' },
      },
    ]);

    expect(result.score).toBe(89);
    expect(result.tier).toBe('production_adjacent');
    expect(result.scoreDetails.appliedCeilings.map(c => c.ruleId)).toContain('authdb.cors_wildcard');
  });

  it('keeps vibe-only findings from dropping below the vibe floor', () => {
    const result = calculateScore([
      finding('ai_slop', 20, 'aislop.mock_data_in_render'),
      finding('ai_slop', 20, 'aislop.todo_auth'),
    ]);

    expect(result.score).toBe(80);
    expect(result.tier).toBe('production_adjacent');
  });
});

describe('scoreToTier', () => {
  it('uses exact documented tier boundaries', () => {
    expect(scoreToTier(0)).toBe('catastrophic');
    expect(scoreToTier(25)).toBe('catastrophic');
    expect(scoreToTier(26)).toBe('vibe_coder_special');
    expect(scoreToTier(50)).toBe('vibe_coder_special');
    expect(scoreToTier(51)).toBe('surprisingly_functional');
    expect(scoreToTier(75)).toBe('surprisingly_functional');
    expect(scoreToTier(76)).toBe('production_adjacent');
    expect(scoreToTier(89)).toBe('production_adjacent');
    expect(scoreToTier(90)).toBe('suspiciously_clean');
    expect(scoreToTier(100)).toBe('suspiciously_clean');
  });
});
