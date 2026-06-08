import type { ScannedFile, Finding } from '../types';

export function firstLineMatch(file: ScannedFile, re: RegExp | string): Finding['evidence'] {
  const pattern = typeof re === 'string' ? new RegExp(re.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : re;
  const lines = file.content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return {
        file: file.path,
        line: i + 1,
        snippet: lines[i].trim().slice(0, 200),
      };
    }
  }
  return { file: file.path };
}

export function countMatches(content: string, re: RegExp): number {
  const m = content.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
  return m ? m.length : 0;
}

export function isClientCodeFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|html)$/i.test(path)
    && (path.startsWith('src/') || path.startsWith('app/') || path.startsWith('pages/') || path.startsWith('components/'));
}

export function isApiRouteFile(path: string): boolean {
  // Next App Router
  if (/^app\/.+\/route\.(ts|js|tsx|jsx|mjs)$/.test(path)) return true;
  // Next Pages Router
  if (/^pages\/api\//.test(path) && /\.(ts|js|tsx|jsx|mjs)$/.test(path)) return true;
  // Common API/function folders
  if (/^(api|functions)\/.+\.(ts|js|tsx|jsx|mjs)$/.test(path)) return true;
  // Cloudflare Worker / Hono entrypoints
  if (/^(src\/)?(index|worker|server|app)\.(ts|js|mjs)$/.test(path)) return true;
  // Supabase Edge Functions
  if (/^supabase\/functions\/[^/]+\/index\.(ts|js|mjs)$/.test(path)) return true;
  // tRPC routers/procedures
  if (/(^|\/)(trpc|routers?)\/.+\.(ts|js|tsx|jsx|mjs)$/.test(path)) return true;
  // Convention-based server folders
  if (/^server\/.+\.(ts|js)$/.test(path)) return true;
  return false;
}
