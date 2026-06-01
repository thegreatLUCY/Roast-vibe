import type { Finding, ScannedRepo } from '../types';
import { firstLineMatch, isApiRouteFile, isClientCodeFile } from './util';

const AUTH_CALL_PATTERNS = [
  /getServerSession\b/,
  /\bauth\s*\(\s*\)/,
  /requireAuth\b/,
  /verifyToken\b/,
  /verifyJWT\b/,
  /supabase\.auth\.getUser\b/,
  /clerkClient\b/,
  /currentUser\b/,
  /getSession\b/,
  /authMiddleware\b/,
  /withAuth\b/,
];

const DB_CALL_PATTERNS = [
  /\b(prisma|db|supabase|drizzle|knex|pool|connection|client)\.(query|from|select|insert|update|delete|execute|exec|raw|unsafe)\b/,
  /\b(prisma)\.\w+\.(findMany|findFirst|findUnique|create|update|delete|upsert)\b/,
  /\bsql\s*`/,
];

export function authDbScanners(repo: ScannedRepo): Finding[] {
  const findings: Finding[] = [];

  for (const file of repo.files) {
    // 1. API routes touching DB with no auth call
    if (isApiRouteFile(file.path)) {
      const touchesDb = DB_CALL_PATTERNS.some(re => re.test(file.content));
      const hasAuth = AUTH_CALL_PATTERNS.some(re => re.test(file.content));
      if (touchesDb && !hasAuth) {
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

    // 2. SQL via template literal with interpolation
    const sqlTplRe = /\b(query|execute|exec|prepare|raw|unsafe|\$queryRawUnsafe|\$executeRawUnsafe)\s*\(\s*`[^`]*\$\{[^`]*\}[^`]*`/;
    if (sqlTplRe.test(file.content)) {
      findings.push({
        ruleId: 'authdb.sql_interpolation',
        bucket: 'auth_db',
        severity: 'catastrophic',
        points: 12,
        title: 'SQL query built with string interpolation (injection risk)',
        evidence: firstLineMatch(file, sqlTplRe),
      });
    }

    // 3. CORS wildcard
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
  }

  // 5. Supabase used but no RLS migrations found
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
        title: 'Uses Supabase but has no migrations directory (RLS likely not configured)',
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
