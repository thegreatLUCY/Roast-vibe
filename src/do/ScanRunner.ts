import type { Env, ScanResult } from '../types';
import { buildScannedRepo, fetchRepoMeta } from '../github';
import { runScanners } from '../scanners';
import { calculateScore } from '../score';
import { generateRoast, pickSnippets } from '../roast';
import { renderCard, type CardVariant } from '../card/render';
import { errorFromCode, errorFromException } from '../errors';

interface StartScanPayload {
  owner: string;
  name: string;
}

export class ScanRunner {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/scan' && request.method === 'POST') {
      return this.handleScan(await request.json() as StartScanPayload);
    }
    if (url.pathname === '/result' && request.method === 'GET') {
      return this.handleGetResult();
    }
    if (url.pathname === '/card' && request.method === 'GET') {
      const variant = (url.searchParams.get('variant') as CardVariant) || 'full';
      return this.handleGetCard(variant);
    }
    return new Response('not found', { status: 404 });
  }

  private async handleGetResult(): Promise<Response> {
    const cached = await this.state.storage.get<ScanResult>('result');
    if (!cached) return new Response('not_found', { status: 404 });
    return Response.json(cached);
  }

  private async handleGetCard(variant: CardVariant): Promise<Response> {
    const cacheKey = `card_${variant}`;
    const cached = await this.state.storage.get<ArrayBuffer>(cacheKey);
    if (cached) {
      return new Response(cached, {
        headers: {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    }

    const result = await this.state.storage.get<ScanResult>('result');
    if (!result) return new Response('not_found', { status: 404 });

    try {
      const png = await renderCard(result, variant);
      await this.state.storage.put(cacheKey, png.buffer);
      return new Response(png, {
        headers: {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (e: any) {
      return new Response('card_render_failed: ' + String(e?.message ?? e), { status: 500 });
    }
  }

  private async handleScan(payload: StartScanPayload): Promise<Response> {
    const cached = await this.state.storage.get<ScanResult>('result');
    if (cached) return Response.json({ cached: true, result: cached });

    const { owner, name } = payload;

    let meta;
    try {
      meta = await fetchRepoMeta(owner, name, this.env.GITHUB_PAT);
    } catch (e) {
      const p = errorFromException(e);
      return Response.json(p, { status: p.status });
    }

    const maxSizeKb = Number(this.env.MAX_REPO_SIZE_KB) || 5000;
    if (meta.sizeKb > maxSizeKb) {
      const p = errorFromCode('REPO_TOO_LARGE', `${(meta.sizeKb / 1024).toFixed(1)} MB`);
      return Response.json(p, { status: p.status });
    }

    let repo;
    try {
      repo = await buildScannedRepo(
        owner,
        name,
        meta,
        this.env.GITHUB_PAT,
        Number(this.env.MAX_FILES_TO_SCAN) || 50,
      );
    } catch (e) {
      const p = errorFromException(e);
      return Response.json(p, { status: p.status });
    }

    const { findings, generator } = runScanners(repo);
    const { score, tier, deductionsByBucket } = calculateScore(findings);

    const snippets = pickSnippets(findings);

    let roast;
    try {
      roast = await generateRoast(
        { repo: `${owner}/${name}`, score, tier, generator, findings, snippets },
        this.env,
      );
    } catch (e) {
      const p = errorFromException(e);
      return Response.json(p, { status: p.status });
    }

    const scanId = `${owner}--${name}--${meta.sha.slice(0, 7)}`.toLowerCase();
    const result: ScanResult = {
      scanId,
      repo: `${owner}/${name}`,
      sha: meta.sha,
      defaultBranch: meta.defaultBranch,
      generator,
      findings,
      score,
      tier,
      deductionsByBucket,
      roast,
      createdAt: Date.now(),
    };

    await this.state.storage.put('result', result);
    return Response.json({ cached: false, result });
  }
}
