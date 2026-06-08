import type { Finding, ScannedRepo, Generator } from '../types';
import { secretScanners } from './secrets';
import { authDbScanners } from './authdb';
import { aiSlopScanners } from './aislop';
import { smellScanners } from './smells';
import { detectGenerator } from './classifier';
import { enrichFinding } from '../findingMeta';

export function runScanners(repo: ScannedRepo): { findings: Finding[]; generator: Generator } {
  const findings: Finding[] = [
    ...secretScanners(repo),
    ...authDbScanners(repo),
    ...aiSlopScanners(repo),
    ...smellScanners(repo),
  ].map(enrichFinding);
  const generator = detectGenerator(repo);
  return { findings, generator };
}
