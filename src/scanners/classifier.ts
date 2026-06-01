import type { Generator, ScannedRepo } from '../types';

interface Signals {
  paths: Set<string>;
  deps: Record<string, string>;
  pkgName: string;
  readme: string;
  fileContents: string; // all loaded file contents concatenated, lowercased
}

function gather(repo: ScannedRepo): Signals {
  const deps = {
    ...(repo.packageJson?.dependencies ?? {}),
    ...(repo.packageJson?.devDependencies ?? {}),
  };
  return {
    paths: new Set(repo.allPaths),
    deps,
    pkgName: String(repo.packageJson?.name ?? ''),
    readme: (repo.readme ?? '').toLowerCase(),
    fileContents: repo.files.map(f => f.content).join('\n').toLowerCase(),
  };
}

const has = (s: Signals, p: string) => s.paths.has(p);
const dep = (s: Signals, n: string) => n in s.deps;
const anyPath = (s: Signals, re: RegExp) => {
  for (const p of s.paths) if (re.test(p)) return true;
  return false;
};

// Scoring approach: each detector returns a confidence score; highest wins.
type Score = { gen: Generator; conf: number };

function scoreLovable(s: Signals): number {
  let c = 0;
  if (dep(s, 'lovable-tagger')) c += 100;                                 // smoking gun
  if (has(s, 'src/integrations/supabase/client.ts')) c += 60;             // Lovable's exact path
  if (s.readme.includes('lovable')) c += 40;
  if (s.fileContents.includes('lovable-tagger')) c += 80;                 // present in vite.config
  if (has(s, 'src/pages/Index.tsx') && has(s, 'src/pages/NotFound.tsx')) c += 25;
  if (dep(s, '@supabase/supabase-js') && (anyPath(s, /^components\/ui\//) || dep(s, 'shadcn-ui'))) c += 15;
  if (anyPath(s, /bun\.lockb?$/) && dep(s, '@supabase/supabase-js')) c += 10;
  return c;
}

function scoreBolt(s: Signals): number {
  let c = 0;
  if (s.pkgName === 'vite-react-typescript-starter') c += 100;            // Bolt's default starter name
  if (s.readme.includes('bolt.new') || s.readme.includes('stackblitz')) c += 50;
  // Bolt's exact dep signature: vite + react + lucide + tailwind + no router, no tests
  if (dep(s, 'vite') && dep(s, 'react') && dep(s, 'lucide-react') && dep(s, 'tailwindcss')) {
    c += 30;
    if (!dep(s, 'react-router-dom') && !dep(s, '@tanstack/react-router')) c += 15;
    if (!dep(s, 'vitest') && !dep(s, '@playwright/test') && !dep(s, 'jest')) c += 10;
  }
  return c;
}

function scoreV0(s: Signals): number {
  let c = 0;
  if (has(s, 'components.json')) c += 60;                                 // shadcn config (v0 ships this)
  if (dep(s, 'geist')) c += 40;                                            // Vercel's Geist font
  if (anyPath(s, /^components\/ui\/(button|card|dialog|input)\.tsx$/)) c += 35;
  if (s.readme.includes('v0.dev') || s.readme.includes('v0 by vercel')) c += 60;
  if (has(s, 'app/page.tsx') && has(s, 'components.json')) c += 20;       // Next App Router + shadcn
  if (s.fileContents.match(/created (with|by|using) v0/i)) c += 30;
  return c;
}

function scoreReplit(s: Signals): number {
  let c = 0;
  if (has(s, '.replit')) c += 80;
  if (has(s, 'replit.nix')) c += 70;
  if (s.readme.includes('replit')) c += 20;
  // Replit Agent's canonical stack
  if (dep(s, '@neondatabase/serverless') && dep(s, 'drizzle-orm') && dep(s, 'express')) c += 30;
  if (has(s, 'server/index.ts') && has(s, 'client/src/main.tsx') && has(s, 'shared/schema.ts')) c += 25;
  return c;
}

function scoreCursor(s: Signals): number {
  let c = 0;
  if (has(s, '.cursorrules')) c += 80;
  if (anyPath(s, /^\.cursor\//)) c += 60;
  if (s.readme.match(/(built|made|generated) with cursor/i)) c += 40;
  return c;
}

function scoreClaudeCode(s: Signals): number {
  let c = 0;
  if (has(s, 'CLAUDE.md')) c += 70;
  if (anyPath(s, /^\.claude\//)) c += 70;
  if (s.fileContents.match(/co-authored-by:?\s+claude/i)) c += 30;
  if (s.readme.match(/(built|made|generated) with claude code/i)) c += 40;
  return c;
}

export function detectGenerator(repo: ScannedRepo): Generator {
  const s = gather(repo);

  const scores: Score[] = [
    { gen: 'lovable',     conf: scoreLovable(s) },
    { gen: 'bolt',        conf: scoreBolt(s) },
    { gen: 'v0',          conf: scoreV0(s) },
    { gen: 'replit',      conf: scoreReplit(s) },
    { gen: 'cursor',      conf: scoreCursor(s) },
    { gen: 'claude_code', conf: scoreClaudeCode(s) },
  ];

  scores.sort((a, b) => b.conf - a.conf);

  // Threshold of 50 keeps us conservative — no false "Made with X" claims.
  if (scores[0].conf >= 50) return scores[0].gen;
  return 'unknown';
}
