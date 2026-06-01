import type { Generator, ScannedRepo } from '../types';

interface Signals {
  paths: Set<string>;
  deps: Record<string, string>;
  pkgName: string;
  readme: string;
  viteConfig: string;
  nextConfig: string;
  fileContents: string;
}

function gather(repo: ScannedRepo): Signals {
  const deps = {
    ...(repo.packageJson?.dependencies ?? {}),
    ...(repo.packageJson?.devDependencies ?? {}),
  };
  const find = (re: RegExp) => repo.files.find(f => re.test(f.path))?.content ?? '';
  return {
    paths: new Set(repo.allPaths),
    deps,
    pkgName: String(repo.packageJson?.name ?? ''),
    readme: (repo.readme ?? '').toLowerCase(),
    viteConfig: find(/^vite\.config\.(ts|js|mjs|cjs)$/),
    nextConfig: find(/^next\.config\.(ts|js|mjs|cjs)$/),
    fileContents: repo.files.map(f => f.content).join('\n').toLowerCase(),
  };
}

const has = (s: Signals, p: string) => s.paths.has(p);
const dep = (s: Signals, n: string) => n in s.deps;
const anyPath = (s: Signals, re: RegExp) => {
  for (const p of s.paths) if (re.test(p)) return true;
  return false;
};

// Each hit declares "strong" — meaning a structural fingerprint, not just a text mention.
// We only award a generator badge if at least one strong signal fires.
interface Hit { points: number; strong: boolean }

function lovableHits(s: Signals): Hit[] {
  const h: Hit[] = [];
  // STRONG: structural — only present in real Lovable apps
  if (dep(s, 'lovable-tagger')) h.push({ points: 100, strong: true });
  if (has(s, 'src/integrations/supabase/client.ts')) h.push({ points: 60, strong: true });
  if (s.viteConfig.includes('lovable-tagger')) h.push({ points: 80, strong: true });
  // WEAK: text mentions, structural guesses
  if (s.readme.includes('lovable')) h.push({ points: 40, strong: false });
  if (has(s, 'src/pages/Index.tsx') && has(s, 'src/pages/NotFound.tsx')) h.push({ points: 25, strong: false });
  if (dep(s, '@supabase/supabase-js') && (anyPath(s, /^components\/ui\//) || dep(s, 'shadcn-ui'))) h.push({ points: 15, strong: false });
  if (anyPath(s, /bun\.lockb?$/) && dep(s, '@supabase/supabase-js')) h.push({ points: 10, strong: false });
  return h;
}

function boltHits(s: Signals): Hit[] {
  const h: Hit[] = [];
  if (s.pkgName === 'vite-react-typescript-starter') h.push({ points: 100, strong: true });
  // Bolt's stack signature on its own is structural enough to be strong-ish, but
  // many people choose this stack independently — keep it weak unless the name matches.
  if (dep(s, 'vite') && dep(s, 'react') && dep(s, 'lucide-react') && dep(s, 'tailwindcss')) {
    h.push({ points: 30, strong: false });
    if (!dep(s, 'react-router-dom') && !dep(s, '@tanstack/react-router')) h.push({ points: 15, strong: false });
    if (!dep(s, 'vitest') && !dep(s, '@playwright/test') && !dep(s, 'jest')) h.push({ points: 10, strong: false });
  }
  if (s.readme.includes('bolt.new') || s.readme.includes('stackblitz')) h.push({ points: 50, strong: false });
  return h;
}

function v0Hits(s: Signals): Hit[] {
  const h: Hit[] = [];
  // STRONG
  if (has(s, 'components.json')) h.push({ points: 60, strong: true });
  if (dep(s, 'geist')) h.push({ points: 40, strong: true });
  if (anyPath(s, /^components\/ui\/(button|card|dialog|input)\.tsx$/)) h.push({ points: 35, strong: true });
  // WEAK
  if (s.readme.includes('v0.dev') || s.readme.includes('v0 by vercel')) h.push({ points: 60, strong: false });
  if (has(s, 'app/page.tsx') && has(s, 'components.json')) h.push({ points: 20, strong: false });
  if (s.nextConfig.match(/created (with|by|using) v0/i)) h.push({ points: 30, strong: false });
  return h;
}

function replitHits(s: Signals): Hit[] {
  const h: Hit[] = [];
  if (has(s, '.replit')) h.push({ points: 80, strong: true });
  if (has(s, 'replit.nix')) h.push({ points: 70, strong: true });
  if (s.readme.includes('replit')) h.push({ points: 20, strong: false });
  if (dep(s, '@neondatabase/serverless') && dep(s, 'drizzle-orm') && dep(s, 'express')) h.push({ points: 30, strong: false });
  if (has(s, 'server/index.ts') && has(s, 'client/src/main.tsx') && has(s, 'shared/schema.ts')) h.push({ points: 25, strong: false });
  return h;
}

function cursorHits(s: Signals): Hit[] {
  const h: Hit[] = [];
  if (has(s, '.cursorrules')) h.push({ points: 80, strong: true });
  if (anyPath(s, /^\.cursor\//)) h.push({ points: 60, strong: true });
  if (s.readme.match(/(built|made|generated) with cursor/i)) h.push({ points: 40, strong: false });
  return h;
}

function claudeCodeHits(s: Signals): Hit[] {
  const h: Hit[] = [];
  if (has(s, 'CLAUDE.md')) h.push({ points: 70, strong: true });
  if (anyPath(s, /^\.claude\//)) h.push({ points: 70, strong: true });
  if (s.readme.match(/(built|made|generated) with claude code/i)) h.push({ points: 40, strong: false });
  return h;
}

export function detectGenerator(repo: ScannedRepo): Generator {
  const s = gather(repo);

  const groups: { gen: Generator; hits: Hit[] }[] = [
    { gen: 'lovable',     hits: lovableHits(s) },
    { gen: 'bolt',        hits: boltHits(s) },
    { gen: 'v0',          hits: v0Hits(s) },
    { gen: 'replit',      hits: replitHits(s) },
    { gen: 'cursor',      hits: cursorHits(s) },
    { gen: 'claude_code', hits: claudeCodeHits(s) },
  ];

  // Require at least one structural (strong) signal to award a badge.
  // Then rank by total confidence among qualifiers.
  const qualifiers = groups
    .filter(g => g.hits.some(h => h.strong))
    .map(g => ({ gen: g.gen, conf: g.hits.reduce((s, h) => s + h.points, 0) }))
    .sort((a, b) => b.conf - a.conf);

  if (qualifiers.length > 0 && qualifiers[0].conf >= 50) return qualifiers[0].gen;
  return 'unknown';
}
