import type { Finding, ScannedRepo } from '../types';
import { firstLineMatch, isApiRouteFile, isClientCodeFile } from './util';

const AUTH_CALL_PATTERNS = [
  /getServerSession\b/,
  /\bauth\s*\(\s*\)/,
  /\brequireAuth\s*\(/,
  /requireAuth\b/,
  /\bauthMiddleware\s*\(/,
  /verifyToken\b/,
  /verifyJWT\b/,
  /supabase\.auth\.getUser\b/,
  /getSupabaseUser\b/,
  /clerkClient\b/,
  /currentUser\b/,
  /getSession\b/,
  /authMiddleware\b/,
  /withAuth\b/,
  /\bprotectedProcedure\b/,
  /\.use\s*\(\s*(auth|requireAuth|authMiddleware|verifyJWT|verifyToken)\b/,
  /\bctx\.user\b/,
  /\bc\.get\s*\(\s*['"]user['"]\s*\)/,
];

const DB_CALL_PATTERNS = [
  /\b(prisma|db|supabase|drizzle|knex|pool|connection|client)\.(query|from|select|insert|update|delete|execute|exec|raw|unsafe)\b/,
  /\b(prisma)\.\w+\.(findMany|findFirst|findUnique|create|update|delete|upsert)\b/,
  /\bctx\.db\.\w+\.(findMany|findFirst|findUnique|create|update|delete|upsert)\b/,
  /\b(c\.)?env\.[A-Z0-9_]*DB\.(prepare|exec|batch)\b/,
  /\bsql\s*`/,
];

export function authDbScanners(repo: ScannedRepo): Finding[] {
  const findings: Finding[] = [];
  const hasServerAuth = repo.files.some(file =>
    (isApiRouteFile(file.path) || isServerAuthFile(file.path))
    && AUTH_CALL_PATTERNS.some(re => re.test(file.content)),
  );

  for (const file of repo.files) {
    // 1. API routes touching DB with no auth call
    if (isApiRouteFile(file.path)) {
      const touchesDb = DB_CALL_PATTERNS.some(re => re.test(file.content));
      const hasAuth = AUTH_CALL_PATTERNS.some(re => re.test(file.content));
      if (touchesDb && !hasAuth && !isPublicAuthEndpoint(file.path)) {
        findings.push({
          ruleId: 'authdb.api_route_no_auth',
          bucket: 'auth_db',
          severity: 'real_risk',
          points: 10,
          title: 'API route touches the database with no auth check',
          evidence: firstLineMatch(file, DB_CALL_PATTERNS[0]),
        });
      }
    }

    // 2. SQL built with string interpolation OR concatenation
    const sqlTplRe = /\b(query|execute|exec|prepare|raw|unsafe|\$queryRawUnsafe|\$executeRawUnsafe)\s*\(\s*`[^`]*\$\{[^`]*\}[^`]*`/;
    const sqlConcatRe = /\b(query|execute|exec|prepare|raw|unsafe|\$queryRawUnsafe|\$executeRawUnsafe)\s*\(\s*["'][^"']*(SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b[^"']*["']\s*\+/i;
    const sqlMatch = sqlTplRe.test(file.content) ? sqlTplRe : sqlConcatRe.test(file.content) ? sqlConcatRe : null;
    if (sqlMatch) {
      findings.push({
        ruleId: 'authdb.sql_interpolation',
        bucket: 'auth_db',
        severity: 'catastrophic',
        points: 12,
        title: 'SQL query built with string interpolation/concat (injection risk)',
        evidence: firstLineMatch(file, sqlMatch),
      });
    }

    // 3. CORS wildcard — only meaningful in real server code, not tests/examples
    const isTestyPath = /\b(__tests__|tests?|specs?|docs?|examples?|fixtures?|mocks?|stories|e2e)\//i.test(file.path);
    if (!isTestyPath) {
      const corsWildcard = /(Access-Control-Allow-Origin\s*['"]?\s*:\s*['"]?\*|cors\s*\(\s*\{[^}]*origin\s*:\s*['"]\*['"]|cors\s*\(\s*\)(?!\s*\.[a-z]))/;
      if (corsWildcard.test(file.content)) {
        findings.push({
          ruleId: 'authdb.cors_wildcard',
          bucket: 'auth_db',
          severity: 'real_risk',
          points: 6,
          title: 'CORS configured with wildcard origin',
          evidence: firstLineMatch(file, corsWildcard),
        });
      }
    }

    // 4. localStorage token storage
    const lsToken = /localStorage\.setItem\s*\(\s*['"](token|jwt|access[_-]?token|auth[_-]?token|id[_-]?token)['"]\s*,/i;
    if (lsToken.test(file.content) && isClientCodeFile(file.path)) {
      findings.push({
        ruleId: 'authdb.localstorage_token',
        bucket: 'auth_db',
        severity: 'real_risk',
        points: 5,
        title: 'Auth token stored in localStorage (XSS-extractable)',
        evidence: firstLineMatch(file, lsToken),
      });
    }

    // 5. Client-side-only route protection: looks protected in React, but no server/API auth exists.
    if (!hasServerAuth && isClientCodeFile(file.path) && looksLikeProtectedClientRoute(file)) {
      findings.push({
        ruleId: 'authdb.client_only_auth',
        bucket: 'auth_db',
        severity: 'real_risk',
        points: 10,
        title: 'Protected route appears enforced only in client-side code',
        evidence: firstLineMatch(file, /localStorage\.getItem|sessionStorage\.getItem|isAuthenticated|isLoggedIn|user\s*===?\s*null|!user\b|!session\b/),
      });
    }
  }

  // 6. Supabase used but no RLS migrations found
  const usesSupabase = !!(repo.packageJson?.dependencies?.['@supabase/supabase-js']
    || repo.packageJson?.devDependencies?.['@supabase/supabase-js']);
  if (usesSupabase) {
    const migrationPaths = repo.allPaths.filter(p => /^supabase\/migrations\/.+\.sql$/.test(p));
    if (migrationPaths.length === 0) {
      findings.push({
        ruleId: 'authdb.supabase_no_migrations',
        bucket: 'auth_db',
        severity: 'real_risk',
        points: 8,
        title: 'Uses Supabase but no supabase/migrations/ directory found in repo',
        evidence: {},
      });
    } else {
      // Look for RLS enable statements across migrations we loaded
      const loadedMigrations = repo.files.filter(f => /^supabase\/migrations\/.+\.sql$/.test(f.path));
      const anyRls = loadedMigrations.some(f =>
        /\benable\s+row\s+level\s+security\b/i.test(f.content)
        || /\bcreate\s+policy\b/i.test(f.content),
      );
      if (loadedMigrations.length > 0 && !anyRls) {
        findings.push({
          ruleId: 'authdb.supabase_no_rls',
          bucket: 'auth_db',
          severity: 'catastrophic',
          points: 12,
          title: 'Supabase migrations exist but none enable Row Level Security',
          evidence: { file: loadedMigrations[0].path },
        });
      }
    }
  }

  return findings;
}

function isServerAuthFile(path: string): boolean {
  return /(^|\/)(middleware|auth|session|jwt|passport|clerk|supabase)\.(ts|js|tsx|jsx|mjs)$/.test(path)
    || /^src\/server\//.test(path)
    || /^lib\/(auth|session)\.(ts|js)$/.test(path);
}

function isPublicAuthEndpoint(path: string): boolean {
  return /(^|\/)api\/auth\/(login|signin|sign-in|register|signup|sign-up|callback|forgot-password|reset-password)\/route\.(ts|js|tsx|jsx|mjs)$/i.test(path)
    || /(^|\/)(login|signin|sign-in|register|signup|sign-up|callback|forgot-password|reset-password)\.(ts|js|mjs)$/i.test(path);
}

function looksLikeProtectedClientRoute(file: { path: string; content: string }): boolean {
  const protectedPath = /(^|\/)(dashboard|admin|account|settings|profile|billing|checkout|portal)(\/|\.|-)/i.test(file.path)
    || /(^|\/)(Dashboard|Admin|Account|Settings|Profile|Billing|Checkout|Portal)[A-Z][\w-]*\.(tsx|jsx|ts|js)$/i.test(file.path);
  const protectedComponent = /\b(Dashboard|Admin|Account|Settings|Profile|Billing|Checkout|Portal)([A-Z]\w*)?\b/.test(file.content);
  if (!protectedPath && !protectedComponent) return false;

  const clientCredentialCheck =
    /localStorage\.getItem\s*\(\s*['"](token|jwt|access[_-]?token|auth[_-]?token|id[_-]?token|user|session)['"]\s*\)/i.test(file.content)
    || /sessionStorage\.getItem\s*\(\s*['"](token|jwt|access[_-]?token|auth[_-]?token|id[_-]?token|user|session)['"]\s*\)/i.test(file.content)
    || /\b(isAuthenticated|isLoggedIn)\b/.test(file.content)
    || /(!user\b|user\s*===?\s*null|!session\b|session\s*===?\s*null)/.test(file.content);

  const loginRedirect =
    /\b(Navigate|Redirect)\b[^;\n]*(\/login|\/signin|\/sign-in)/i.test(file.content)
    || /\bnavigate\s*\(\s*['"]\/(login|signin|sign-in)/i.test(file.content)
    || /\b(router|navigate|history)\.(push|replace)\s*\(\s*['"]\/(login|signin|sign-in)/i.test(file.content)
    || /window\.location\.(href|assign|replace)\s*=?\s*\(?\s*['"]\/(login|signin|sign-in)/i.test(file.content);

  return clientCredentialCheck && loginRedirect;
}
