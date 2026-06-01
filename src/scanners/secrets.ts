import type { Finding, ScannedRepo } from '../types';
import { firstLineMatch } from './util';

interface Pattern {
  ruleId: string;
  title: string;
  points: number;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { ruleId: 'secrets.openai_key', title: 'OpenAI API key in source', points: 20, re: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { ruleId: 'secrets.anthropic_key', title: 'Anthropic API key in source', points: 20, re: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/ },
  { ruleId: 'secrets.stripe_live_key', title: 'Stripe live secret key in source', points: 20, re: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { ruleId: 'secrets.aws_access_key', title: 'AWS access key in source', points: 18, re: /\bAKIA[0-9A-Z]{16}\b/ },
  { ruleId: 'secrets.github_pat', title: 'GitHub Personal Access Token in source', points: 18, re: /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { ruleId: 'secrets.google_api_key', title: 'Google API key in source', points: 10, re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { ruleId: 'secrets.hardcoded_jwt_secret', title: 'Hardcoded JWT signing secret', points: 14, re: /(jwt|JWT)_?SECRET\s*[:=]\s*["'][^"']{1,40}["']/ },
];

// Files we don't penalize secrets in
function isAllowList(path: string): boolean {
  return /\.env\.example$/i.test(path)
    || /\.env\.sample$/i.test(path)
    || /\bREADME/i.test(path)
    || /\bCHANGELOG/i.test(path)
    || /\b(docs?|examples?)\//i.test(path);
}

function isClientReachable(path: string): boolean {
  return path.startsWith('src/')
    || path.startsWith('app/')
    || path.startsWith('pages/')
    || path.startsWith('components/')
    || path.startsWith('public/')
    || /vite\.config/.test(path)
    || /next\.config/.test(path);
}

function decodeJwtPayload(token: string): any | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const pad = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4);
    const b64 = pad.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

export function secretScanners(repo: ScannedRepo): Finding[] {
  const findings: Finding[] = [];

  // 1. .env committed
  const envFiles = repo.allPaths.filter(p =>
    /(^|\/)\.env$/.test(p) ||
    /(^|\/)\.env\.local$/.test(p) ||
    /(^|\/)\.env\.production$/.test(p),
  );
  for (const p of envFiles) {
    const f = repo.files.find(x => x.path === p);
    // If content present and contains anything that looks like a real value (not just KEY=xxx placeholders)
    let realLooking = true;
    if (f) {
      const lines = f.content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      realLooking = lines.some(l => {
        const v = l.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
        return v.length >= 8 && !/^(your[-_]?|xxx|change[-_]?me|example|placeholder|todo)/i.test(v);
      });
    }
    findings.push({
      ruleId: 'secrets.env_committed',
      bucket: 'secrets',
      severity: realLooking ? 'catastrophic' : 'real_risk',
      points: realLooking ? 18 : 6,
      title: realLooking ? `.env file committed with real-looking values (${p})` : `.env file committed (${p})`,
      evidence: { file: p, snippet: f ? f.content.split('\n').slice(0, 3).join('\n') : undefined },
    });
  }

  // 1b. .env not in .gitignore
  if (repo.hasGitignore && !repo.envInGitignore && envFiles.length === 0) {
    findings.push({
      ruleId: 'secrets.env_not_gitignored',
      bucket: 'secrets',
      severity: 'smell',
      points: 3,
      title: '.env files are not in .gitignore',
      evidence: { file: '.gitignore' },
    });
  }

  // 2. Regex secret patterns in files
  for (const file of repo.files) {
    if (isAllowList(file.path)) continue;
    for (const pat of PATTERNS) {
      const m = file.content.match(pat.re);
      if (m) {
        findings.push({
          ruleId: pat.ruleId,
          bucket: 'secrets',
          severity: 'catastrophic',
          points: pat.points,
          title: pat.title,
          evidence: firstLineMatch(file, pat.re),
        });
      }
    }

    // 3. JWT detection + Supabase service_role decode
    const jwtMatches = file.content.match(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g);
    if (jwtMatches) {
      for (const tok of jwtMatches) {
        const payload = decodeJwtPayload(tok);
        if (payload && payload.role === 'service_role') {
          findings.push({
            ruleId: 'secrets.supabase_service_role',
            bucket: 'secrets',
            severity: 'catastrophic',
            points: 20,
            title: 'Supabase service_role JWT exposed in client-reachable code',
            evidence: firstLineMatch(file, new RegExp(tok.slice(0, 40))),
          });
          break;
        }
      }
    }

    // 4. Public env var that contains "secret" / "private"
    const pubSecret = file.content.match(/\b(NEXT_PUBLIC|VITE|REACT_APP)_[A-Z0-9_]*(SECRET|PRIVATE|SERVICE_ROLE|ADMIN)[A-Z0-9_]*\b/);
    if (pubSecret && isClientReachable(file.path)) {
      findings.push({
        ruleId: 'secrets.public_env_for_secret',
        bucket: 'secrets',
        severity: 'catastrophic',
        points: 15,
        title: `Secret-named env var prefixed for the client bundle: ${pubSecret[0]}`,
        evidence: firstLineMatch(file, pubSecret[0]),
      });
    }
  }

  return findings;
}
