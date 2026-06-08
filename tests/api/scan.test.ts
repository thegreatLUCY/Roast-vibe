import { beforeEach, describe, expect, it, vi } from 'vitest';
import app, { ScanRunner } from '../../src/index';
import type { Env } from '../../src/types';

const SHA = '0123456789abcdef0123456789abcdef01234567';

class MemoryStorage {
  private values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

class FakeDb {
  globalCount = 0;
  ipCount = 0;

  prepare(sql: string) {
    const db = this;
    return {
      bind() {
        return {
          async run() {
            if (sql.includes('rate_limits_global')) db.globalCount += 1;
            if (sql.includes('rate_limits_ip')) db.ipCount += 1;
            return { success: true };
          },
          async first() {
            if (sql.includes('rate_limits_global')) return { count: db.globalCount };
            if (sql.includes('rate_limits_ip')) return { count: db.ipCount };
            if (sql.includes('reports')) return null;
            return null;
          },
        };
      },
    };
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function blob(content: string): Response {
  return json({
    encoding: 'base64',
    content: Buffer.from(content, 'utf8').toString('base64'),
  });
}

function createEnv(): Env {
  const stores = new Map<string, MemoryStorage>();
  let env: Env;

  const scanRunnerNamespace = {
    idFromName(name: string) {
      return name;
    },
    get(id: string) {
      const storage = stores.get(id) ?? new MemoryStorage();
      stores.set(id, storage);
      const runner = new ScanRunner({ storage } as unknown as DurableObjectState, env);
      return {
        fetch(input: RequestInfo | URL, init?: RequestInit) {
          return runner.fetch(new Request(input, init));
        },
      };
    },
  };

  env = {
    SCAN_RUNNER: scanRunnerNamespace as unknown as DurableObjectNamespace,
    DB: new FakeDb() as unknown as D1Database,
    ASSETS: { fetch: () => new Response('<html><head></head><body></body></html>') } as unknown as Fetcher,
    OPENROUTER_API_KEY: 'test-openrouter-key',
    GITHUB_PAT: 'test-github-token',
    ENVIRONMENT: 'test',
    OPENROUTER_MODEL: 'test-model',
    MAX_REPO_SIZE_KB: '5000',
    MAX_FILES_TO_SCAN: '50',
    MAX_LLM_INPUT_TOKENS: '8000',
    MAX_LLM_OUTPUT_TOKENS: '300',
    RATE_LIMIT_PER_IP_PER_DAY: '99',
    RATE_LIMIT_GLOBAL_PER_DAY: '999',
  };

  return env;
}

function installFetchMock() {
  const openAiKey = 'sk-' + 'proj-' + '123456789012345678901234';
  const files: Record<string, string> = {
    pkg: JSON.stringify({
      dependencies: {
        '@supabase/supabase-js': '^2.0.0',
        vite: '^5.0.0',
        react: '^18.0.0',
      },
      devDependencies: {
        'lovable-tagger': '^1.0.0',
      },
    }),
    readme: '# Welcome to your Lovable project\n\nUse Lovable to edit this app.',
    env: `OPENAI_API_KEY=${openAiKey}\nDATABASE_URL=postgres://real-looking-value`,
    app: 'export function App() { return <main>hello</main>; }',
  };

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url === 'https://api.github.com/repos/lovable-env/app') {
      return json({ default_branch: 'main', size: 12, private: false });
    }
    if (url === 'https://api.github.com/repos/lovable-env/app/commits/main') {
      return json({ sha: SHA });
    }
    if (url === `https://api.github.com/repos/lovable-env/app/git/trees/${SHA}?recursive=1`) {
      return json({
        truncated: false,
        tree: [
          { type: 'blob', path: 'package.json', sha: 'pkg', size: files.pkg.length },
          { type: 'blob', path: 'README.md', sha: 'readme', size: files.readme.length },
          { type: 'blob', path: '.env', sha: 'env', size: files.env.length },
          { type: 'blob', path: 'src/App.tsx', sha: 'app', size: files.app.length },
        ],
      });
    }
    const blobMatch = url.match(/^https:\/\/api\.github\.com\/repos\/lovable-env\/app\/git\/blobs\/(\w+)$/);
    if (blobMatch) {
      return blob(files[blobMatch[1]]);
    }
    if (url === 'https://openrouter.ai/api/v1/chat/completions') {
      return json({
        choices: [{
          message: {
            content: JSON.stringify({
              tagline: 'env file did a confessional',
              sins: [
                'The repo committed a real-looking .env file and called that a deployment strategy.',
                'The README is still the untouched Lovable template, because branding can apparently wait.',
                'The score got capped because secrets in git history are not a quirky launch detail.',
              ],
              verdict: 'This is not production-adjacent; it is credential archaeology with a UI. Rotate everything and try again.',
            }),
          },
        }],
      });
    }

    return json({ error: `unhandled ${url}` }, 500);
  }));
}

describe('/api/scan integration', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installFetchMock();
  });

  it('scores a committed real-looking .env through the API and caches the DO result', async () => {
    const env = createEnv();

    const scanResponse = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.4' },
      body: JSON.stringify({ url: 'https://github.com/lovable-env/app' }),
    }, env);

    expect(scanResponse.status).toBe(200);
    const scanBody = await scanResponse.json() as any;
    expect(scanBody.cached).toBe(false);
    expect(scanBody.result.generator).toBe('lovable');
    expect(scanBody.result.score).toBe(45);
    expect(scanBody.result.tier).toBe('vibe_coder_special');
    expect(scanBody.result.findings.map((f: any) => f.ruleId)).toContain('secrets.env_committed');
    expect(scanBody.result.scoreDetails.appliedCeilings.map((c: any) => c.ruleId)).toContain('secrets.env_committed');
    expect(scanBody.result.scoreDetails.appliedCeilings.map((c: any) => c.ruleId)).toContain('combo.committed_env_supabase_no_migrations');

    const resultResponse = await app.request(`/api/result/${scanBody.result.scanId}`, {
      headers: { 'CF-Connecting-IP': '203.0.113.4' },
    }, env);
    expect(resultResponse.status).toBe(200);
    const resultBody = await resultResponse.json() as any;
    expect(resultBody.score).toBe(45);
    expect(resultBody.roast.sins).toHaveLength(3);

    const cachedResponse = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.4' },
      body: JSON.stringify({ url: 'lovable-env/app' }),
    }, env);
    const cachedBody = await cachedResponse.json() as any;
    expect(cachedBody.cached).toBe(true);
    expect(cachedBody.result.scanId).toBe(scanBody.result.scanId);
    expect(cachedBody.result.score).toBe(45);
  });
});
