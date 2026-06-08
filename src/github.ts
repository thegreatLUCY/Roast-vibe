import type { ScannedFile, ScannedRepo, PackageJson } from './types';

const GH = 'https://api.github.com';

function headers(pat: string): HeadersInit {
  const h: HeadersInit = {
    'User-Agent': 'roastvibe-scanner',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (pat) h.Authorization = `Bearer ${pat}`;
  return h;
}

export function parseRepoUrl(input: string): { owner: string; name: string } | null {
  const trimmed = input.trim();
  const m = trimmed.match(/github\.com[/:]+([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (!m) {
    // Allow bare "owner/repo"
    const bare = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (bare) return { owner: bare[1], name: bare[2] };
    return null;
  }
  return { owner: m[1], name: m[2] };
}

export interface RepoMeta {
  owner: string;
  name: string;
  defaultBranch: string;
  sizeKb: number;
  sha: string;
  isPrivate: boolean;
}

export async function fetchRepoMeta(owner: string, name: string, pat: string): Promise<RepoMeta> {
  const r = await fetch(`${GH}/repos/${owner}/${name}`, { headers: headers(pat) });
  if (r.status === 404) throw new Error('REPO_NOT_FOUND');
  if (r.status === 403) throw new Error('GITHUB_RATE_LIMITED');
  if (!r.ok) throw new Error(`GITHUB_API_ERROR_${r.status}`);
  const j = await r.json() as any;
  if (j.private) throw new Error('REPO_PRIVATE');

  const c = await fetch(`${GH}/repos/${owner}/${name}/commits/${j.default_branch}`, {
    headers: headers(pat),
  });
  if (!c.ok) throw new Error(`GITHUB_API_ERROR_${c.status}`);
  const cj = await c.json() as any;

  return {
    owner,
    name,
    defaultBranch: j.default_branch,
    sizeKb: j.size ?? 0,
    sha: cj.sha,
    isPrivate: !!j.private,
  };
}

interface TreeBlob { path: string; sha: string; size: number }

async function fetchTree(owner: string, name: string, sha: string, pat: string): Promise<{ blobs: TreeBlob[]; truncated: boolean }> {
  const r = await fetch(`${GH}/repos/${owner}/${name}/git/trees/${sha}?recursive=1`, {
    headers: headers(pat),
  });
  if (!r.ok) throw new Error(`GITHUB_API_ERROR_${r.status}`);
  const j = await r.json() as any;
  const blobs: TreeBlob[] = (j.tree as any[])
    .filter(e => e.type === 'blob')
    .map(e => ({ path: e.path as string, sha: e.sha as string, size: e.size as number ?? 0 }));
  return { blobs, truncated: !!j.truncated };
}

async function fetchBlob(owner: string, name: string, sha: string, pat: string): Promise<string> {
  const r = await fetch(`${GH}/repos/${owner}/${name}/git/blobs/${sha}`, { headers: headers(pat) });
  if (!r.ok) throw new Error(`GITHUB_API_ERROR_${r.status}`);
  const j = await r.json() as any;
  if (j.encoding === 'base64') {
    try {
      return atob((j.content as string).replace(/\n/g, ''));
    } catch {
      return '';
    }
  }
  return j.content ?? '';
}

const SKIP_DIRS = [
  'node_modules/', 'dist/', 'build/', '.next/', '.nuxt/', 'out/', '.turbo/',
  'coverage/', '.cache/', '.vercel/', '.netlify/', 'public/build/',
];

const SKIP_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'avif', 'bmp',
  'pdf', 'zip', 'tar', 'gz', 'rar', '7z',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp3', 'mp4', 'mov', 'webm', 'wav',
  'lock', 'snap',
]);

const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'composer.lock', 'Cargo.lock', 'poetry.lock',
]);

const HIGH_PRIORITY_PATTERNS = [
  /^package\.json$/i,
  /^README\.md$/i,
  /^\.env(\..+)?$/i,
  /^\.gitignore$/i,
  /^index\.html$/i,
  /^components\.json$/i,
  /^\.replit$/i,
  /^replit\.nix$/i,
  /^\.cursorrules$/i,
  /^CLAUDE\.md$/i,
  /^supabase\/migrations\//i,
  /^firebase\.(json|rules)$/i,
  /^firestore\.rules$/i,
  /^vite\.config\.(t|j)s$/i,
  /^next\.config\.(m|c)?(t|j)s$/i,
  /^astro\.config\.(m|c)?(t|j)s$/i,
];

function isInterestingPath(path: string): boolean {
  for (const d of SKIP_DIRS) if (path.startsWith(d) || path.includes('/' + d)) return false;
  const base = path.split('/').pop() ?? path;
  if (SKIP_FILES.has(base)) return false;
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
  if (SKIP_EXTS.has(ext)) return false;
  return true;
}

function priorityScore(path: string): number {
  for (let i = 0; i < HIGH_PRIORITY_PATTERNS.length; i++) {
    if (HIGH_PRIORITY_PATTERNS[i].test(path)) return 100 - i;
  }
  // Shallow paths first; src/ and app/ get a small bonus.
  const depth = path.split('/').length;
  let bonus = 0;
  if (path.startsWith('src/') || path.startsWith('app/') || path.startsWith('pages/api/')) bonus = 5;
  if (path.match(/\.(ts|tsx|js|jsx|mjs|cjs|sql|env|yml|yaml|toml)$/i)) bonus += 3;
  if (path.match(/\.(md|json)$/i)) bonus += 1;
  return 50 - depth + bonus;
}

const MAX_FILE_BYTES = 200_000; // 200KB per file ceiling

export async function buildScannedRepo(
  owner: string,
  name: string,
  meta: RepoMeta,
  pat: string,
  maxFiles: number,
): Promise<ScannedRepo> {
  const { blobs } = await fetchTree(owner, name, meta.sha, pat);
  const allPaths = blobs.map(b => b.path);

  // Filter + rank
  const ranked = blobs
    .filter(b => isInterestingPath(b.path))
    .filter(b => b.size <= MAX_FILE_BYTES)
    .map(b => ({ b, p: priorityScore(b.path) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, maxFiles)
    .map(x => x.b);

  // Fetch contents in parallel (but cap concurrency at 10 to be safe)
  const files: ScannedFile[] = [];
  const concurrency = 10;
  for (let i = 0; i < ranked.length; i += concurrency) {
    const slice = ranked.slice(i, i + concurrency);
    const fetched = await Promise.all(
      slice.map(async (b): Promise<ScannedFile | null> => {
        try {
          const content = await fetchBlob(owner, name, b.sha, pat);
          return { path: b.path, content, size: b.size };
        } catch {
          return null;
        }
      }),
    );
    for (const f of fetched) if (f) files.push(f);
  }

  // Load every package.json across the tree (not just root) and merge deps.
  // This makes monorepos / backend+frontend repos behave correctly without bloating
  // the main file-content budget.
  let packageJson: PackageJson | null = null;
  {
    const pkgBlobs = blobs
      .filter(b => /(^|\/)package\.json$/.test(b.path))
      .filter(b => !b.path.includes('node_modules/'))
      .filter(b => b.size <= MAX_FILE_BYTES)
      .slice(0, 10); // cap to avoid pathological repos

    const loaded: { path: string; json: PackageJson }[] = [];
    await Promise.all(
      pkgBlobs.map(async (b) => {
        // Skip refetch if already loaded as a main file
        const existing = files.find(f => f.path === b.path);
        try {
          const content = existing ? existing.content : await fetchBlob(owner, name, b.sha, pat);
          const json = JSON.parse(content) as PackageJson;
          loaded.push({ path: b.path, json });
          if (!existing) {
            files.push({ path: b.path, content, size: b.size });
          }
        } catch { /* invalid json or fetch fail */ }
      }),
    );

    if (loaded.length > 0) {
      const root = loaded.find(p => p.path === 'package.json') ?? loaded[0];
      const mergedDeps: Record<string, string> = {};
      const mergedDevDeps: Record<string, string> = {};
      for (const p of loaded) {
        Object.assign(mergedDeps, p.json.dependencies ?? {});
        Object.assign(mergedDevDeps, p.json.devDependencies ?? {});
      }
      packageJson = {
        ...root.json,
        dependencies: mergedDeps,
        devDependencies: mergedDevDeps,
      };
    }
  }

  const readme = files.find(f => /^README\.md$/i.test(f.path))?.content ?? null;
  const hasGitignore = allPaths.some(p => p === '.gitignore');
  const giFile = files.find(f => f.path === '.gitignore');
  const envInGitignore = giFile ? /(^|\n)\.env(\..+)?(\s|$)/.test(giFile.content) : false;

  return {
    owner,
    name,
    sha: meta.sha,
    defaultBranch: meta.defaultBranch,
    sizeKb: meta.sizeKb,
    files,
    allPaths,
    packageJson,
    readme,
    hasGitignore,
    envInGitignore,
  };
}
