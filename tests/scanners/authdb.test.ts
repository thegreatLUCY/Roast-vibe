import { describe, expect, it } from 'vitest';
import { authDbScanners } from '../../src/scanners/authdb';
import { file, repo } from '../helpers/repo';

function rulesFor(files: ReturnType<typeof file>[]): string[] {
  return authDbScanners(repo(files)).map(f => f.ruleId);
}

describe('authDbScanners', () => {
  it('flags API routes that touch the database without an auth check', () => {
    const rules = rulesFor([
      file('app/api/orders/route.ts', `
        export async function POST(req: Request) {
          const body = await req.json();
          await prisma.order.create({ data: body });
          return Response.json({ ok: true });
        }
      `),
    ]);

    expect(rules).toContain('authdb.api_route_no_auth');
  });

  it('does not flag DB API routes that perform a server-side auth check', () => {
    const rules = rulesFor([
      file('app/api/orders/route.ts', `
        import { auth } from '@/auth';
        export async function POST(req: Request) {
          const session = await auth();
          if (!session) return new Response('unauthorized', { status: 401 });
          const body = await req.json();
          await prisma.order.create({ data: body });
          return Response.json({ ok: true });
        }
      `),
    ]);

    expect(rules).not.toContain('authdb.api_route_no_auth');
  });

  it('does not require auth on public login/register endpoints that create credentials', () => {
    const rules = rulesFor([
      file('app/api/auth/login/route.ts', `
        export async function POST(req: Request) {
          const body = await req.json();
          const user = await prisma.user.findUnique({ where: { email: body.email } });
          return Response.json({ ok: !!user });
        }
      `),
      file('app/api/auth/register/route.ts', `
        export async function POST(req: Request) {
          const body = await req.json();
          const user = await prisma.user.create({ data: body });
          return Response.json({ id: user.id });
        }
      `),
    ]);

    expect(rules).not.toContain('authdb.api_route_no_auth');
  });

  it('still flags authenticated-session auth endpoints that touch DB without checking the current user', () => {
    const rules = rulesFor([
      file('app/api/auth/me/route.ts', `
        export async function GET() {
          const user = await prisma.user.findFirst();
          return Response.json(user);
        }
      `),
    ]);

    expect(rules).toContain('authdb.api_route_no_auth');
  });

  it('flags Express routes that touch the database without auth', () => {
    const rules = rulesFor([
      file('server/index.ts', `
        app.post('/api/orders', async (req, res) => {
          const rows = await db.query('select * from orders');
          res.json(rows);
        });
      `),
    ]);

    expect(rules).toContain('authdb.api_route_no_auth');
  });

  it('does not flag Express routes protected by auth middleware', () => {
    const rules = rulesFor([
      file('server/index.ts', `
        app.post('/api/orders', requireAuth, async (req, res) => {
          const rows = await db.query('select * from orders');
          res.json(rows);
        });
      `),
    ]);

    expect(rules).not.toContain('authdb.api_route_no_auth');
  });

  it('flags Hono handlers that touch the database without auth', () => {
    const rules = rulesFor([
      file('src/index.ts', `
        const app = new Hono();
        app.post('/orders', async (c) => {
          const rows = await c.env.DB.prepare('select * from orders').all();
          return c.json(rows);
        });
      `),
    ]);

    expect(rules).toContain('authdb.api_route_no_auth');
  });

  it('does not flag Hono handlers protected by auth middleware', () => {
    const rules = rulesFor([
      file('src/index.ts', `
        const app = new Hono();
        app.use('/orders/*', authMiddleware());
        app.post('/orders', async (c) => {
          const user = c.get('user');
          const rows = await c.env.DB.prepare('select * from orders where user_id = ?').bind(user.id).all();
          return c.json(rows);
        });
      `),
    ]);

    expect(rules).not.toContain('authdb.api_route_no_auth');
  });

  it('flags Cloudflare Worker fetch handlers that touch D1 without auth', () => {
    const rules = rulesFor([
      file('src/worker.ts', `
        export default {
          async fetch(req, env) {
            const rows = await env.DB.prepare('select * from invoices').all();
            return Response.json(rows);
          }
        }
      `),
    ]);

    expect(rules).toContain('authdb.api_route_no_auth');
  });

  it('does not flag Worker handlers with JWT verification', () => {
    const rules = rulesFor([
      file('src/worker.ts', `
        export default {
          async fetch(req, env) {
            const user = await verifyJWT(req.headers.get('Authorization'));
            const rows = await env.DB.prepare('select * from invoices where user_id = ?').bind(user.id).all();
            return Response.json(rows);
          }
        }
      `),
    ]);

    expect(rules).not.toContain('authdb.api_route_no_auth');
  });

  it('flags Supabase Edge Functions touching data without user auth', () => {
    const rules = rulesFor([
      file('supabase/functions/create-order/index.ts', `
        Deno.serve(async (req) => {
          const supabase = createClient(url, anonKey);
          const { data } = await supabase.from('orders').select('*');
          return new Response(JSON.stringify(data));
        });
      `),
    ]);

    expect(rules).toContain('authdb.api_route_no_auth');
  });

  it('does not flag Supabase Edge Functions that call supabase.auth.getUser()', () => {
    const rules = rulesFor([
      file('supabase/functions/create-order/index.ts', `
        Deno.serve(async (req) => {
          const supabase = createClient(url, anonKey);
          const { data: { user } } = await supabase.auth.getUser(req.headers.get('Authorization'));
          const { data } = await supabase.from('orders').select('*').eq('user_id', user.id);
          return new Response(JSON.stringify(data));
        });
      `),
    ]);

    expect(rules).not.toContain('authdb.api_route_no_auth');
  });

  it('flags tRPC procedures touching DB without protected middleware', () => {
    const rules = rulesFor([
      file('src/server/routers/orders.ts', `
        export const ordersRouter = router({
          list: publicProcedure.query(async ({ ctx }) => {
            return ctx.db.order.findMany();
          }),
        });
      `),
    ]);

    expect(rules).toContain('authdb.api_route_no_auth');
  });

  it('does not flag tRPC protected procedures', () => {
    const rules = rulesFor([
      file('src/server/routers/orders.ts', `
        export const ordersRouter = router({
          list: protectedProcedure.query(async ({ ctx }) => {
            return ctx.db.order.findMany({ where: { userId: ctx.user.id } });
          }),
        });
      `),
    ]);

    expect(rules).not.toContain('authdb.api_route_no_auth');
  });

  it('flags SQL interpolation and concatenation in query calls', () => {
    const rules = rulesFor([
      file('server/search.ts', `
        export async function search(term: string) {
          return db.query(\`SELECT * FROM users WHERE email = '\${term}'\`);
        }
      `),
      file('server/delete.ts', `
        export async function remove(id: string) {
          return db.query('DELETE FROM users WHERE id = ' + id);
        }
      `),
    ]);

    expect(rules.filter(r => r === 'authdb.sql_interpolation')).toHaveLength(2);
  });

  it('flags client-side localStorage token storage', () => {
    const rules = rulesFor([
      file('src/App.tsx', `
        export function saveToken(token: string) {
          localStorage.setItem('access_token', token);
        }
      `),
    ]);

    expect(rules).toContain('authdb.localstorage_token');
  });

  it('flags protected routes enforced only by client-side localStorage redirects', () => {
    const rules = rulesFor([
      file('src/pages/Dashboard.tsx', `
        import { useEffect } from 'react';
        import { useNavigate } from 'react-router-dom';

        export function Dashboard() {
          const navigate = useNavigate();
          useEffect(() => {
            const token = localStorage.getItem('token');
            if (!token) navigate('/login');
          }, [navigate]);
          return <main>Revenue</main>;
        }
      `),
    ]);

    expect(rules).toContain('authdb.client_only_auth');
  });

  it('does not flag client route guards when server auth enforcement is present', () => {
    const rules = rulesFor([
      file('middleware.ts', `
        import { authMiddleware } from '@clerk/nextjs';
        export default authMiddleware({});
      `),
      file('src/pages/Dashboard.tsx', `
        export function Dashboard() {
          if (!isAuthenticated) return <Navigate to="/login" />;
          return <main>Revenue</main>;
        }
      `),
    ]);

    expect(rules).not.toContain('authdb.client_only_auth');
  });

  it('does not flag ordinary login UI as client-only route protection', () => {
    const rules = rulesFor([
      file('src/pages/Login.tsx', `
        export function Login() {
          const isAuthenticated = false;
          return <form>{isAuthenticated ? 'Welcome back' : 'Sign in'}</form>;
        }
      `),
    ]);

    expect(rules).not.toContain('authdb.client_only_auth');
  });

  it('flags Supabase apps without migrations and accepts migrations that enable RLS', () => {
    const missing = authDbScanners(repo([
      file('package.json', JSON.stringify({
        dependencies: {
          '@supabase/supabase-js': '^2.0.0',
        },
      })),
    ]));

    const protectedRepo = authDbScanners(repo([
      file('package.json', JSON.stringify({
        dependencies: {
          '@supabase/supabase-js': '^2.0.0',
        },
      })),
      file('supabase/migrations/0001_init.sql', `
        alter table public.profiles enable row level security;
        create policy "Profiles are private" on public.profiles for select using (auth.uid() = id);
      `),
    ]));

    expect(missing.map(f => f.ruleId)).toContain('authdb.supabase_no_migrations');
    expect(protectedRepo.map(f => f.ruleId)).not.toContain('authdb.supabase_no_migrations');
    expect(protectedRepo.map(f => f.ruleId)).not.toContain('authdb.supabase_no_rls');
  });
});
