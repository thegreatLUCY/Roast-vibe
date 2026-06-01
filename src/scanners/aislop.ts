import type { Finding, ScannedRepo } from '../types';
import { firstLineMatch, countMatches, isClientCodeFile } from './util';

const SLOP_COMMENTS = [
  { re: /\/\/\s*(This is a (basic|simple) implementation|For (demo|demonstration) purposes|In a (real|production) (app|application|environment)|You (would|should|might) (want to )?(add|implement|replace))/i, label: 'AI-style cop-out comment' },
  { re: /\/\/\s*\.\.\.?\s*(rest of |existing |previous |other )?(code|implementation|logic)[^\n]*?(remains|stays|unchanged|same)/i, label: 'Paste-incomplete comment ("rest of code remains the same")' },
];

const PLACEHOLDER_STRINGS = [
  { re: /\bLorem ipsum\b/i, label: 'Lorem ipsum text shipped' },
  { re: /\bJohn Doe\b/, label: '"John Doe" placeholder shipped' },
  { re: /\bjane@example\.com\b/i, label: '"jane@example.com" placeholder shipped' },
  { re: /\bAcme (Inc|Corp|Co\.?)\b/, label: '"Acme Inc" placeholder shipped' },
  { re: /Your Company Name\b/, label: '"Your Company Name" placeholder shipped' },
];

const DEFAULT_TITLES = [
  { re: /<title>\s*Vite \+ React\s*<\/title>/i, label: 'Default <title>Vite + React</title> never changed' },
  { re: /<title>\s*Create Next App\s*<\/title>/i, label: 'Default <title>Create Next App</title> never changed' },
  { re: /<title>\s*lovable-generated-project\s*<\/title>/i, label: 'Default lovable-generated-project title never changed' },
  { re: /<title>\s*v0 by Vercel\s*<\/title>/i, label: 'Default <title>v0 by Vercel</title> never changed' },
];

export function aiSlopScanners(repo: ScannedRepo): Finding[] {
  const findings: Finding[] = [];

  let totalLoc = 0;
  let totalTodos = 0;

  for (const file of repo.files) {
    // 1. Slop comments
    for (const sc of SLOP_COMMENTS) {
      if (sc.re.test(file.content)) {
        findings.push({
          ruleId: 'aislop.comment_' + sc.label.toLowerCase().replace(/[^a-z]+/g, '_').slice(0, 30),
          bucket: 'ai_slop',
          severity: 'smell',
          points: 3,
          title: sc.label,
          evidence: firstLineMatch(file, sc.re),
        });
      }
    }

    // 2. TODO/FIXME counting per file (collect, deduct at end)
    totalLoc += file.content.split('\n').length;
    totalTodos += countMatches(file.content, /\b(TODO|FIXME|XXX|HACK)\b/);

    // 2b. TODO with auth specifically
    const todoAuth = /\bTODO[^\n]*\b(auth|authenticate|authorization|login)/i;
    if (todoAuth.test(file.content)) {
      findings.push({
        ruleId: 'aislop.todo_auth',
        bucket: 'ai_slop',
        severity: 'real_risk',
        points: 4,
        title: 'TODO comment mentions auth not yet implemented',
        evidence: firstLineMatch(file, todoAuth),
      });
    }

    // 3. Placeholder strings (only in code/HTML, not READMEs)
    if (!/README/i.test(file.path)) {
      for (const ps of PLACEHOLDER_STRINGS) {
        if (ps.re.test(file.content)) {
          findings.push({
            ruleId: 'aislop.placeholder_' + ps.label.toLowerCase().replace(/[^a-z]+/g, '_').slice(0, 30),
            bucket: 'ai_slop',
            severity: 'cosmetic',
            points: 1,
            title: ps.label,
            evidence: firstLineMatch(file, ps.re),
          });
        }
      }
    }

    // 4. mockUsers / dummyData referenced from rendered components
    if (isClientCodeFile(file.path)) {
      const mockRefs = /\b(mockUsers|dummyData|fakeProducts|sampleData|mockProducts|fakeUsers|placeholderData)\b/;
      if (mockRefs.test(file.content)) {
        // Filter out test files
        if (!/\.(test|spec)\./i.test(file.path) && !file.path.includes('__tests__')) {
          findings.push({
            ruleId: 'aislop.mock_data_in_render',
            bucket: 'ai_slop',
            severity: 'smell',
            points: 3,
            title: 'Mock/dummy data referenced from rendered code',
            evidence: firstLineMatch(file, mockRefs),
          });
        }
      }
    }

    // 5. Default titles
    for (const dt of DEFAULT_TITLES) {
      if (dt.re.test(file.content)) {
        findings.push({
          ruleId: 'aislop.default_title_' + dt.label.toLowerCase().replace(/[^a-z]+/g, '_').slice(0, 20),
          bucket: 'ai_slop',
          severity: 'cosmetic',
          points: 2,
          title: dt.label,
          evidence: firstLineMatch(file, dt.re),
        });
      }
    }

    // 6. alert/confirm/prompt as UI
    const alertUse = /\b(alert|confirm|prompt)\s*\(\s*['"`]/;
    if (alertUse.test(file.content) && isClientCodeFile(file.path)) {
      findings.push({
        ruleId: 'aislop.alert_ui',
        bucket: 'ai_slop',
        severity: 'smell',
        points: 2,
        title: 'alert()/confirm()/prompt() used for production UI',
        evidence: firstLineMatch(file, alertUse),
      });
    }

    // 7. Emoji-laden console.log
    const emojiLog = /console\.log\s*\(\s*['"`][^'"`]*(?:\uD83D|\uD83E|✨|🔥|⚡|🚀)/u;
    if (emojiLog.test(file.content)) {
      findings.push({
        ruleId: 'aislop.emoji_console',
        bucket: 'ai_slop',
        severity: 'cosmetic',
        points: 1,
        title: 'Emoji-laden console.log left in code',
        evidence: firstLineMatch(file, emojiLog),
      });
    }
  }

  // 8. README is pure AI template
  if (repo.readme) {
    const aiReadme = /^#\s+Welcome to your (Lovable|Bolt|v0|Replit)/i;
    if (aiReadme.test(repo.readme)) {
      findings.push({
        ruleId: 'aislop.ai_template_readme',
        bucket: 'ai_slop',
        severity: 'cosmetic',
        points: 2,
        title: 'README is the untouched AI-generated template',
        evidence: { file: 'README.md', snippet: repo.readme.split('\n')[0] },
      });
    }
  }

  // 9. TODO density (deduct once per repo based on density)
  if (totalLoc > 200) {
    const per1k = (totalTodos / totalLoc) * 1000;
    if (per1k >= 5) {
      findings.push({
        ruleId: 'aislop.todo_density',
        bucket: 'ai_slop',
        severity: 'smell',
        points: 3,
        title: `High density of TODO/FIXME comments (${totalTodos} across ${totalLoc} LoC, ${per1k.toFixed(1)}/1K)`,
        evidence: {},
      });
    }
  }

  return findings;
}
