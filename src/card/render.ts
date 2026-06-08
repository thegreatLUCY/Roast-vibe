import type { Generator, ScanResult, Tier } from '../types';
import { loadInter } from './fonts';

let resvgInit: Promise<void> | null = null;
let satoriFn: ((node: any, opts: any) => Promise<string>) | null = null;
let ResvgClass: any = null;

async function ensureRenderers(): Promise<void> {
  if (resvgInit) {
    await resvgInit;
    return;
  }
  resvgInit = (async () => {
    const [{ default: satori }, resvg, wasmModule] = await Promise.all([
      import('satori'),
      import('@resvg/resvg-wasm'),
      // @ts-expect-error wasm import is provided by wrangler bundler
      import('@resvg/resvg-wasm/index_bg.wasm'),
    ]);
    satoriFn = satori as any;
    ResvgClass = resvg.Resvg;
    await resvg.initWasm((wasmModule as any).default as WebAssembly.Module);
  })();
  await resvgInit;
}

type SatoriNode =
  | string
  | { type: string; props: { children?: SatoriNode | SatoriNode[]; [k: string]: any } };

function h(type: string, props: Record<string, any> = {}, ...children: SatoriNode[]): SatoriNode {
  return {
    type,
    props: {
      ...props,
      children:
        children.length === 0
          ? undefined
          : children.length === 1
            ? children[0]
            : children,
    },
  };
}

const COLORS = {
  bg: '#0a0a0a',
  bgSoft: '#141414',
  bgCard: '#1a1a1a',
  fg: '#f5f5f5',
  fgDim: '#8a8a8a',
  fgMuted: '#5a5a5a',
  border: '#2a2a2a',
  red: '#ff3b30',
  orange: '#ff8a00',
  yellow: '#ffd60a',
  green: '#34c759',
};

const TIER_LABEL: Record<Tier, string> = {
  catastrophic: 'CATASTROPHIC',
  vibe_coder_special: 'VIBE-CODER SPECIAL',
  surprisingly_functional: 'SURPRISINGLY FUNCTIONAL',
  production_adjacent: 'PRODUCTION-ADJACENT',
  suspiciously_clean: 'SUSPICIOUSLY CLEAN',
};

const TIER_FALLBACK: Record<Tier, string> = {
  catastrophic: 'a catastrophe in three acts',
  vibe_coder_special: 'a working demo and many time bombs',
  surprisingly_functional: 'better than expected',
  production_adjacent: 'suspiciously competent',
  suspiciously_clean: 'almost embarrassment-free',
};

const GENERATOR_LABEL: Record<Generator, string | null> = {
  lovable: 'Made with Lovable',
  bolt: 'Made with Bolt.new',
  v0: 'Made with v0',
  replit: 'Made with Replit Agent',
  cursor: 'Vibe-coded via Cursor',
  claude_code: 'Built with Claude Code',
  codex: 'Built with Codex',
  unknown: null,
};

function tierColor(tier: Tier): string {
  if (tier === 'catastrophic') return COLORS.red;
  if (tier === 'vibe_coder_special') return COLORS.orange;
  if (tier === 'surprisingly_functional') return COLORS.yellow;
  return COLORS.green;
}

function trim(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function buildFullCard(result: ScanResult): SatoriNode {
  const tierC = tierColor(result.tier);
  const generatorBadge = GENERATOR_LABEL[result.generator];
  // Keep 3 sins, but prefer shorter ones so the card doesn't wrap them.
  const ordered = [...result.roast.sins].sort((a, b) => a.length - b.length);
  const topSins = ordered.slice(0, 3);

  return h(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        background: COLORS.bg,
        display: 'flex',
        flexDirection: 'column',
        padding: '52px 56px',
        fontFamily: 'Inter',
        color: COLORS.fg,
        position: 'relative',
      },
    },
    // Header strip
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 20,
          color: COLORS.fgDim,
          marginBottom: 28,
          fontWeight: 700,
        },
      },
      h('div', { style: { color: COLORS.red, display: 'flex' } }, '▌ roast.vibe'),
      generatorBadge
        ? h(
            'div',
            {
              style: {
                background: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 999,
                padding: '6px 16px',
                fontSize: 18,
                color: COLORS.fgDim,
                display: 'flex',
              },
            },
            '⚠ ' + generatorBadge,
          )
        : h('div', { style: { display: 'flex' } }, ''),
    ),
    // Repo identifier
    h(
      'div',
      {
        style: {
          fontSize: 26,
          color: COLORS.fg,
          marginBottom: 18,
          display: 'flex',
          fontWeight: 700,
        },
      },
      'github.com/' + trim(result.repo, 48),
    ),
    // Score + tier row
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 36, marginBottom: 32 } },
      h(
        'div',
        {
          style: {
            fontSize: 200,
            lineHeight: 1,
            color: tierC,
            fontWeight: 900,
            letterSpacing: '-0.04em',
            display: 'flex',
          },
        },
        String(result.score),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        h('div', { style: { fontSize: 26, color: COLORS.fgMuted, display: 'flex' } }, '/ 100'),
        h(
          'div',
          {
            style: {
              fontSize: 48,
              fontWeight: 900,
              color: COLORS.fg,
              letterSpacing: '-0.02em',
              marginTop: 8,
              display: 'flex',
            },
          },
          TIER_LABEL[result.tier],
        ),
        h(
          'div',
          { style: { fontSize: 22, color: COLORS.fgDim, marginTop: 4, display: 'flex' } },
          ('"' + (result.roast.tagline || TIER_FALLBACK[result.tier]) + '"'),
        ),
      ),
    ),
    // Top sins
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 } },
      h(
        'div',
        {
          style: {
            fontSize: 16,
            color: COLORS.red,
            fontWeight: 700,
            letterSpacing: '0.2em',
            display: 'flex',
          },
        },
        'THE SINS',
      ),
      ...topSins.map((s, i) =>
        h(
          'div',
          {
            style: {
              display: 'flex',
              gap: 14,
              fontSize: 19,
              color: COLORS.fg,
              lineHeight: 1.3,
              maxHeight: 50,
              overflow: 'hidden',
            },
          },
          h(
            'div',
            { style: { color: COLORS.fgMuted, display: 'flex', minWidth: 28 } },
            '0' + (i + 1),
          ),
          h('div', { style: { display: 'flex', flex: 1 } }, trim(s, 180)),
        ),
      ),
    ),
    // Bottom strip
    h(
      'div',
      {
        style: {
          position: 'absolute',
          bottom: 28,
          left: 56,
          right: 56,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 18,
          color: COLORS.fgMuted,
        },
      },
      h('div', { style: { display: 'flex' } }, 'roast.vibe'),
      h(
        'div',
        { style: { display: 'flex' } },
        result.findings.length + ' findings · ' + result.sha.slice(0, 7),
      ),
    ),
  );
}

function buildScoreOnlyCard(result: ScanResult): SatoriNode {
  const tierC = tierColor(result.tier);
  const generatorBadge = GENERATOR_LABEL[result.generator];

  return h(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        background: COLORS.bg,
        display: 'flex',
        flexDirection: 'column',
        padding: '48px 56px',
        fontFamily: 'Inter',
        color: COLORS.fg,
        position: 'relative',
      },
    },
    // Top bar: logo + optional generator badge
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 22,
          fontWeight: 700,
        },
      },
      h('div', { style: { color: COLORS.red, display: 'flex' } }, '▌ roast.vibe'),
      generatorBadge
        ? h(
            'div',
            {
              style: {
                background: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 999,
                padding: '6px 18px',
                fontSize: 20,
                color: COLORS.fgDim,
                display: 'flex',
              },
            },
            '⚠ ' + generatorBadge,
          )
        : h('div', { style: { display: 'flex' } }, ''),
    ),
    // Center stack: score on top, tier below
    h(
      'div',
      {
        style: {
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      // Number + /100 baseline-aligned
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'flex-end',
            gap: 16,
            lineHeight: 0.9,
          },
        },
        h(
          'div',
          {
            style: {
              fontSize: 280,
              color: tierC,
              fontWeight: 900,
              letterSpacing: '-0.04em',
              display: 'flex',
              lineHeight: 0.9,
            },
          },
          String(result.score),
        ),
        h(
          'div',
          {
            style: {
              fontSize: 44,
              color: COLORS.fgMuted,
              display: 'flex',
              paddingBottom: 24,
            },
          },
          '/ 100',
        ),
      ),
      h(
        'div',
        {
          style: {
            fontSize: 56,
            fontWeight: 900,
            color: COLORS.fg,
            letterSpacing: '-0.02em',
            marginTop: 8,
            display: 'flex',
            textAlign: 'center',
          },
        },
        TIER_LABEL[result.tier],
      ),
      h(
        'div',
        {
          style: {
            fontSize: 26,
            color: COLORS.fgDim,
            marginTop: 12,
            display: 'flex',
          },
        },
        'github.com/' + trim(result.repo, 48),
      ),
    ),
    // Footer
    h(
      'div',
      {
        style: {
          display: 'flex',
          justifyContent: 'center',
          fontSize: 20,
          color: COLORS.fgMuted,
        },
      },
      'roast.vibe · ' + result.findings.length + ' findings',
    ),
  );
}

export type CardVariant = 'full' | 'score_only';

export async function renderCard(
  result: ScanResult,
  variant: CardVariant,
): Promise<Uint8Array> {
  await ensureRenderers();
  const [bold, black] = await Promise.all([loadInter(700), loadInter(900)]);

  const node = variant === 'full' ? buildFullCard(result) : buildScoreOnlyCard(result);

  const svg = await satoriFn!(node as any, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Inter', data: bold, weight: 700, style: 'normal' },
      { name: 'Inter', data: black, weight: 900, style: 'normal' },
    ],
  });

  const resvg = new ResvgClass(svg, { fitTo: { mode: 'width', value: 1200 } });
  return resvg.render().asPng();
}
