import { describe, expect, it } from 'vitest';
import { runScanners } from '../../src/scanners';
import { calculateScore } from '../../src/score';
import { file, repo } from '../helpers/repo';

function scanFixture(files: ReturnType<typeof file>[]) {
  const scanned = repo(files);
  const scan = runScanners(scanned);
  const score = calculateScore(scan.findings, scanned);
  return { ...scan, ...score };
}

function ruleIds(findings: ReturnType<typeof runScanners>['findings']): string[] {
  return findings.map(f => f.ruleId);
}

describe('golden scanner pipeline fixtures', () => {
  it('classifies a leaky Supabase vibe app as catastrophic', () => {
    const serviceRoleJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature';
    const openAiKey = 'sk-' + 'proj-' + '123456789012345678901234';
    const stripeLiveKey = 'sk_' + 'live_' + '123456789012345678901234';
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          '@supabase/supabase-js': '^2.0.0',
          vite: '^5.0.0',
          react: '^18.0.0',
        },
        devDependencies: {
          'lovable-tagger': '^1.0.0',
        },
      })),
      file('.env', `
        OPENAI_API_KEY=${openAiKey}
        STRIPE_SECRET_KEY=${stripeLiveKey}
      `),
      file('src/integrations/supabase/client.ts', `
        import { createClient } from '@supabase/supabase-js';
        export const supabase = createClient('https://demo.supabase.co', '${serviceRoleJwt}');
      `),
      file('app/api/orders/route.ts', `
        export async function POST(req: Request) {
          const body = await req.json();
          await db.query('INSERT INTO orders(user_id, total) VALUES (' + body.userId + ', ' + body.total + ')');
          return Response.json({ ok: true });
        }
      `),
      file('src/App.tsx', `
        localStorage.setItem('token', session.access_token);
        export function App() {
          return <main>checkout</main>;
        }
      `),
    ]);

    expect(result.generator).toBe('lovable');
    expect(ruleIds(result.findings)).toEqual(expect.arrayContaining([
      'secrets.env_committed',
      'secrets.openai_key',
      'secrets.stripe_live_key',
      'secrets.supabase_service_role',
      'authdb.supabase_no_migrations',
      'authdb.api_route_no_auth',
      'authdb.sql_interpolation',
      'authdb.localstorage_token',
    ]));
    expect(result.deductionsByBucket.secrets).toBe(50);
    expect(result.deductionsByBucket.auth_db).toBe(30);
    expect(result.score).toBeLessThanOrEqual(25);
    expect(result.tier).toBe('catastrophic');
  });

  it('penalizes a rendered fake-data SaaS without treating it like a breach', () => {
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
          react: '^18.0.0',
        },
      })),
      file('index.html', '<title>Vite + React</title>'),
      file('src/Dashboard.tsx', `
        // In a real app you would replace this with your database.
        // TODO: add auth before launch.
        const mockUsers = [
          { name: 'John Doe', email: 'jane@example.com', company: 'Acme Inc' },
        ];
        export function Dashboard() {
          if (!localStorage.getItem('token')) navigate('/login');
          return <main>{mockUsers.map(user => <div>{user.email}</div>)}</main>;
        }
      `),
    ]);

    expect(ruleIds(result.findings)).toEqual(expect.arrayContaining([
      'authdb.client_only_auth',
      'aislop.mock_data_in_render',
      'aislop.todo_auth',
    ]));
    expect(result.score).toBeGreaterThan(50);
    expect(result.score).toBeLessThan(100);
    expect(result.tier).toBe('surprisingly_functional');
    expect(result.deductionsByBucket.secrets).toBe(0);
    expect(result.deductionsByBucket.auth_db).toBe(10);
  });

  it('keeps a clean generated app suspiciously clean', () => {
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
          react: '^18.0.0',
        },
        devDependencies: {
          vitest: '^4.0.0',
        },
      })),
      file('.gitignore', '.env\nnode_modules\ndist\n'),
      file('index.html', '<title>Launch Review</title>'),
      file('src/App.tsx', `
        export function App() {
          return <main>Launch Review</main>;
        }
      `),
    ]);

    expect(result.findings).toEqual([]);
    expect(result.score).toBe(100);
    expect(result.tier).toBe('suspiciously_clean');
  });

  it('does not treat test and playground env fixtures as leaked production secrets', () => {
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
          react: '^18.0.0',
        },
      })),
      file('packages/app/src/node/__tests__/env/.env', 'DATABASE_URL=postgres://fixture'),
      file('packages/app/src/node/server/__tests__/fixtures/watcher/custom-env/.env', 'API_KEY=fixture-value'),
      file('playground/env/.env.production', 'VITE_PUBLIC_VALUE=fixture-value'),
      file('src/App.tsx', 'export function App() { return <main>ok</main>; }'),
    ]);

    expect(ruleIds(result.findings)).not.toContain('secrets.env_committed');
    expect(result.deductionsByBucket.secrets).toBe(0);
    expect(result.score).toBe(100);
    expect(result.tier).toBe('suspiciously_clean');
  });

  it('does not penalize a repo only because .gitignore omits .env', () => {
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
          react: '^18.0.0',
        },
      })),
      file('.gitignore', 'node_modules\ndist\n'),
      file('src/App.tsx', 'export function App() { return <main>ok</main>; }'),
    ]);

    expect(ruleIds(result.findings)).not.toContain('secrets.env_not_gitignored');
    expect(result.findings).toEqual([]);
    expect(result.score).toBe(100);
  });

  it('detects obvious AI-builder README residue even without structural files', () => {
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
          react: '^18.0.0',
        },
      })),
      file('README.md', `
        # Pastry Dashboard

        Tech: PostgreSQL | Lovable
      `),
      file('src/App.tsx', 'export function App() { return <main>ok</main>; }'),
    ]);

    expect(result.generator).toBe('lovable');
    expect(result.score).toBe(100);
  });

  it('detects Codex README fingerprints as generator flavor', () => {
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
          react: '^18.0.0',
        },
      })),
      file('README.md', `
        # Astronomical Clock Demo

        Interactive astronomical clock demo built with Codex.
      `),
      file('src/App.tsx', 'export function App() { return <main>clock</main>; }'),
    ]);

    expect(result.generator).toBe('codex');
    expect(result.score).toBe(100);
  });

  it('roasts a Codex-built admin app that is only a browser database with fake auth', () => {
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
          react: '^18.0.0',
        },
      })),
      file('README.md', `
        # Clinic Admin

        Patient scheduling dashboard implemented with Codex.
      `),
      file('src/pages/AdminDashboard.tsx', `
        const seedPatients = [
          { id: 'p1', name: 'John Doe', status: 'scheduled', amount: 250 },
          { id: 'p2', name: 'Jane Doe', status: 'unpaid', amount: 175 },
        ];

        export function AdminDashboard() {
          const user = JSON.parse(localStorage.getItem('user') || 'null');
          if (!user) navigate('/login');

          const patients = JSON.parse(localStorage.getItem('patients') || JSON.stringify(seedPatients));
          function savePatient(patient) {
            localStorage.setItem('patients', JSON.stringify([...patients, patient]));
          }

          return <main>{patients.map(patient => <button onClick={() => savePatient(patient)}>{patient.name}</button>)}</main>;
        }
      `),
    ]);

    expect(result.generator).toBe('codex');
    expect(ruleIds(result.findings)).toEqual(expect.arrayContaining([
      'authdb.client_only_auth',
      'aislop.hardcoded_production_data',
      'aislop.localstorage_database',
    ]));
    expect(result.scoreDetails.comboRules.map(c => c.id)).toContain('combo.browser_only_fake_backend');
    expect(result.score).toBeLessThanOrEqual(75);
    expect(result.tier).toBe('vibe_coder_special');
  });

  it('penalizes Claude-style server code that ships secret fallbacks and unauthenticated data APIs', () => {
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          hono: '^4.0.0',
        },
      })),
      file('CLAUDE.md', 'This repo is maintained with Claude Code.'),
      file('src/index.ts', `
        import { Hono } from 'hono';
        const app = new Hono();
        const jwtSecret = process.env.JWT_SECRET || 'temporary-dev-secret';

        app.post('/api/orders', async c => {
          const body = await c.req.json();
          await c.env.DB.prepare('INSERT INTO orders(user_id,total) VALUES (?,?)').run(body.userId, body.total);
          return c.json({ ok: true, jwtSecret });
        });

        export default app;
      `),
    ]);

    expect(result.generator).toBe('claude_code');
    expect(ruleIds(result.findings)).toEqual(expect.arrayContaining([
      'secrets.env_secret_fallback',
      'authdb.api_route_no_auth',
    ]));
    expect(result.scoreDetails.comboRules.map(c => c.id)).toContain('combo.env_fallback_unauth_api');
    expect(result.score).toBeLessThanOrEqual(55);
    expect(result.tier).toBe('vibe_coder_special');
  });

  it('treats default Vite starter README as light vibe residue', () => {
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
          react: '^18.0.0',
        },
      })),
      file('README.md', `
        # Aura

        Vite + React + TypeScript starter
      `),
      file('src/App.tsx', 'export function App() { return <main>ok</main>; }'),
    ]);

    expect(ruleIds(result.findings)).toContain('aislop.ai_template_readme');
    expect(result.score).toBe(98);
    expect(result.tier).toBe('suspiciously_clean');
  });

  it('penalizes storefronts that render hardcoded catalog data and fake frontend-only orders', () => {
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
          react: '^18.0.0',
        },
      })),
      file('src/pages/Checkout.tsx', `
        const products = [
          { id: 'p1', name: 'Launch Plan', price: 99, stock: 5 },
          { id: 'p2', name: 'Scale Plan', price: 199, stock: 2 },
        ];

        export function Checkout() {
          const placeOrder = () => {
            localStorage.setItem('last_order', JSON.stringify(products));
            alert('Order placed successfully');
            navigate('/orders/success');
          };

          return <main>{products.map(product => <button onClick={placeOrder}>{product.name}</button>)}</main>;
        }
      `),
    ]);

    expect(ruleIds(result.findings)).toEqual(expect.arrayContaining([
      'aislop.hardcoded_production_data',
      'aislop.frontend_only_commerce_flow',
    ]));
    expect(result.scoreDetails.comboRules.map(c => c.id)).toContain('combo.frontend_only_fake_commerce');
    expect(result.score).toBeLessThanOrEqual(85);
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it('does not let the non-production floor override fake commerce ceilings', () => {
    const result = scanFixture([
      file('src/App.jsx', `
        const classes = [
          { id: 'c1', name: 'Yoga Flow', price: 40, customer: 'John Doe' },
          { id: 'c2', name: 'Pilates', price: 45, customer: 'Jane Doe' },
        ];

        export function App() {
          const bookClass = () => {
            localStorage.setItem('bookings', JSON.stringify(classes));
            alert('Payment confirmed and booking complete');
          };

          return <main>{classes.map(item => <button onClick={bookClass}>Checkout {item.name}</button>)}</main>;
        }
      `),
    ]);

    expect(ruleIds(result.findings)).toEqual(expect.arrayContaining([
      'aislop.localstorage_database',
      'aislop.frontend_only_commerce_flow',
      'aislop.hardcoded_production_data',
    ]));
    expect(result.scoreDetails.appliedCeilings.map(c => c.ruleId)).toContain('combo.frontend_only_fake_commerce');
    expect(result.score).toBe(75);
    expect(result.tier).toBe('surprisingly_functional');
  });

  it('does not call a checkout UI frontend-only when it posts to an API route', () => {
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
          react: '^18.0.0',
        },
      })),
      file('src/pages/Checkout.tsx', `
        export function Checkout() {
          const placeOrder = async () => {
            await fetch('/api/orders', { method: 'POST' });
            navigate('/orders/success');
          };
          return <button onClick={placeOrder}>Place order</button>;
        }
      `),
      file('api/orders.ts', `
        export async function POST(req: Request) {
          const user = await verifyJWT(req.headers.get('Authorization'));
          return Response.json({ ok: true, userId: user.id });
        }
      `),
    ]);

    expect(ruleIds(result.findings)).not.toContain('aislop.frontend_only_commerce_flow');
  });

  it('does not score docs/spec/e2e examples as production secrets or auth risk', () => {
    const openAiKey = 'sk-' + 'proj-' + '123456789012345678901234';
    const result = scanFixture([
      file('package.json', JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
          react: '^18.0.0',
        },
      })),
      file('openspec/specs/lint.md', `Example key: ${openAiKey}`),
      file('docs/API.md', 'For local testing only, CORS may use Access-Control-Allow-Origin: *'),
      file('apps/web/e2e/admin-backup.e2e.ts', `
        async function setup() {
          await page.goto('/admin');
          await page.click('button');
        }
      `),
      file('src/App.tsx', 'export function App() { return <main>ok</main>; }'),
    ]);

    expect(ruleIds(result.findings)).not.toContain('secrets.openai_key');
    expect(ruleIds(result.findings)).not.toContain('authdb.cors_wildcard');
    expect(ruleIds(result.findings)).not.toContain('smell.async_no_try');
    expect(result.score).toBe(100);
  });
});
