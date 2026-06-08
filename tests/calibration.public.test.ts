import { describe, expect, it } from 'vitest';
import { parseRepoUrl, fetchRepoMeta, buildScannedRepo } from '../src/github';
import { runScanners } from '../src/scanners';
import { calculateScore } from '../src/score';

const DEFAULT_PUBLIC_REPOS = [
  'sindresorhus/is-online',
  'vitejs/vite',
  'vercel/ai',
];

const runCalibration = process.env.RUN_PUBLIC_REPO_CALIBRATION === '1';
const publicRepos = (process.env.PUBLIC_REPOS?.split(',').map(r => r.trim()).filter(Boolean) ?? DEFAULT_PUBLIC_REPOS);

describe.skipIf(!runCalibration)('public repo scanner calibration', () => {
  it('prints scanner-only scores for public repositories', async () => {
    const results = [];

    for (const input of publicRepos) {
      const parsed = parseRepoUrl(input);
      expect(parsed).not.toBeNull();
      if (!parsed) continue;

      const meta = await fetchRepoMeta(parsed.owner, parsed.name, process.env.GITHUB_PAT ?? '');
      const scanned = await buildScannedRepo(parsed.owner, parsed.name, meta, process.env.GITHUB_PAT ?? '', 50);
      const { findings, generator } = runScanners(scanned);
      const scored = calculateScore(findings, scanned);
      const topFindings = [...findings]
        .sort((a, b) => b.points - a.points)
        .slice(0, 8)
        .map(f => ({
          ruleId: f.ruleId,
          points: f.points,
          file: f.evidence.file,
          line: f.evidence.line,
          title: f.title,
        }));

      results.push({
        repo: input,
        filesScanned: scanned.files.length,
        generator,
        score: scored.score,
        tier: scored.tier,
        deductionsByBucket: scored.deductionsByBucket,
        scoreDetails: {
          productionSurface: scored.scoreDetails.productionSurface,
          riskScore: scored.scoreDetails.riskScore,
          vibeScore: scored.scoreDetails.vibeScore,
          qualityScore: scored.scoreDetails.qualityScore,
          comboRules: scored.scoreDetails.comboRules,
          appliedCeilings: scored.scoreDetails.appliedCeilings,
        },
        findingCount: findings.length,
        topFindings,
      });
    }

    console.log(JSON.stringify(results, null, 2));
    expect(results).toHaveLength(publicRepos.length);
  }, 180_000);
});
