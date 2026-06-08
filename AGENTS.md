# AGENTS.md — Context for AI Assistants

If you are an AI assistant (Claude, Codex, Cursor, etc.) being asked to read, modify, or review code in this repository, **start here**. This file is the compressed orientation pack so you don't need to read every file to be useful.

---

## What this project is

**Roast Vibe** is a web tool that roasts AI-generated apps. A user submits a public GitHub repo URL; the system returns a deterministic Production Readiness Score (0–100), an LLM-written roast, and a shareable PNG card.

For full design rationale and decisions log, see [`SPEC.md`](./SPEC.md). For the user-facing summary, see [`README.md`](./README.md). This file is the working context.

---

## Core architectural principles (do not violate)

1. **The score is deterministic. The LLM never touches the score.** Score is computed by rules-based scanners in pure code. Same repo at the same commit SHA must always produce the same score. If you add a feature that lets an LLM influence the score, you are breaking the product.

2. **The funnel is sacred.** Cheap work first (fetch + filter), deterministic work next (scanners), LLM call last on a minimal slice. Do not send whole repos to the LLM. The LLM receives only: the structured findings list, 5–10 worst-offender snippets, and prompt metadata. Total LLM input ≤ ~8K tokens.

3. **Cache by `${owner}/${repo}@${sha}`.** This is the Durable Object ID. Same input → same DO → same cached result + cached PNGs. Do not re-scan on cache hit.

4. **No infrastructure cost.** The only paid line item is OpenRouter LLM usage. Do not introduce services that require a credit card or recurring fees (this is why we use Durable Object SQLite for PNG storage instead of R2).

5. **Public repos only.** Do not add OAuth or private-repo support without explicit instruction.

6. **Roast tone has no leash.** The dev is fair game. Do not soften the prompt to be "more professional" — that breaks the product.

---

## Stack reference

| Component | Tech | Notes |
|---|---|---|
| Runtime | Cloudflare Workers | Free plan. Edge runtime, not Node — no `fs`, no `child_process`, no native modules |
| API framework | Hono | Routes currently live in `src/index.ts` |
| Long-running scan | Durable Object `ScanRunner` | SQLite-backed; ID = `owner/repo@sha` |
| Relational data | D1 | Rate limits, newsletter signups, reports |
| Image storage | DO SQLite (PNG blobs) | **Not R2.** R2 requires a card; we don't use it |
| Frontend | React + Vite | Served via Worker Static Assets |
| Share card | Satori + Resvg-js | JSX → SVG → PNG, runs in Worker |
| LLM | OpenRouter | Default Sonnet-class; configurable via env |
| GitHub | Unauth + PAT for higher rate limit | Stored as Worker secret |

---

## Directory layout

```
roastvibe/
├── README.md
├── SPEC.md                      ← full design doc, source of truth
├── AGENTS.md                    ← this file
├── wrangler.jsonc               ← CF Workers config: bindings, DOs, D1, assets
├── package.json
├── src/
│   ├── index.ts                 ← Worker entry, Hono API routes + OG meta route
│   ├── do/
│   │   └── ScanRunner.ts        ← Durable Object: orchestrates the scan
│   ├── scanners/                ← Deterministic rules. One file per bucket.
│   │   ├── secrets.ts
│   │   ├── authdb.ts
│   │   ├── aislop.ts
│   │   ├── classifier.ts
│   │   └── smells.ts
│   ├── score.ts                 ← Findings → score. Pure function. Capped per bucket.
│   ├── roast.ts                 ← OpenRouter call. Prompt + findings → roast text
│   ├── github.ts                ← GitHub API helpers (tree fetch, file fetch, size check)
│   ├── card/
│   │   ├── render.ts            ← Satori layout
│   │   └── fonts.ts             ← Font loading
│   ├── ratelimit.ts             ← D1-backed rate limiter
│   └── types.ts                 ← Shared types: Finding, Severity, ScanResult, etc.
├── frontend/                    ← React + Vite app
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Landing.tsx
│   │   │   └── Result.tsx
│   │   └── ...
│   └── vite.config.ts
└── migrations/                  ← D1 schema migrations
```

---

## Domain types

The scanner pipeline revolves around a small set of types:

```ts
type Severity = 'cosmetic' | 'smell' | 'real_risk' | 'catastrophic';
type Confidence = 'high' | 'medium' | 'low';
type ScoreAxis = 'risk' | 'vibe' | 'quality' | 'classifier';

interface Finding {
  ruleId: string;          // e.g. "secrets.openai_key_in_client"
  bucket: 'secrets' | 'auth_db' | 'ai_slop' | 'classifier' | 'smell';
  severity: Severity;
  confidence?: Confidence;
  axis?: ScoreAxis;
  points: number;          // positive deduction before bucket cap
  title: string;           // short human label, used in card and roast
  evidence: {              // proof — also fed to LLM as snippet context
    file?: string;
    line?: number;
    snippet?: string;
  };
}

interface ScanResult {
  scanId: string;
  repo: string;            // "owner/name"
  sha: string;
  defaultBranch: string;
  generator: 'lovable' | 'bolt' | 'v0' | 'replit' | 'cursor' | 'claude_code' | 'codex' | 'unknown';
  findings: Finding[];
  score: number;           // 0..100
  tier: 'catastrophic' | 'vibe_coder_special' | 'surprisingly_functional' | 'production_adjacent' | 'suspiciously_clean';
  deductionsByBucket: Record<'secrets' | 'auth_db' | 'ai_slop' | 'classifier' | 'smell', number>;
  scoreDetails: {
    productionSurface: boolean;
    riskScore: number;
    vibeScore: number;
    qualityScore: number;
    confidenceCounts: Record<Confidence, number>;
    appliedCeilings: { ruleId: string; maxScore: number; reason: string }[];
    comboRules: { id: string; points: number; reason: string }[];
  };
  roast: {
    tagline: string;
    sins: string[];        // 3-5 bullets
    verdict: string;       // 2-3 sentences
  };
  createdAt: number;
}
```

Treat these as load-bearing. If you change them, check every consumer.

---

## Scoring rubric

5 buckets, each with a deduction cap. Per-rule points are tunable; bucket caps are the safety rail.

| Bucket | Cap | Examples |
|---|---|---|
| Secrets | -50 | Committed `.env`, `sk-...` in client, Supabase `service_role` JWT exposed, hardcoded secret fallback |
| Auth & DB | -30 | API route with no auth call, SQL string concat, no RLS migrations, client-only route protection |
| AI-slop tells | -20 | `// In a real app...`, hardcoded production arrays, browser-only business-data persistence, fake frontend checkout |
| Classifier | 0 | Not scored — used to flavor the roast |
| Quality smells | -5 | Two state libs, async handler no try/catch, 500+ LoC component |

`score = max(0, 100 - sum_of_capped_deductions)`

After bucket caps, `src/score.ts` applies confidence weighting, risk/vibe/quality detail scores, combo deductions for corroborated failures, score ceilings for severe production risks, and floors so vibe-only/cosmetic-only findings do not masquerade as catastrophes. Repeated unauthenticated data APIs cap at 40. Real-looking committed `.env` plus missing Supabase migrations caps at 45. Real-looking committed `.env` files cap at 50. Protected apps that store both auth state and business data only in browser storage are also capped at 50 because that is a fake backend, not a rough edge.

Score tiers: 0–25 catastrophic, 26–50 vibe-coder special, 51–75 surprisingly functional, 76–89 production-adjacent, 90–100 suspiciously clean.

Full rule list in `SPEC.md` §5.

---

## What you should and shouldn't do as an agent

### Do
- Read `SPEC.md` before proposing architectural changes.
- Match the existing file structure. New scanners go in `src/scanners/`, one rule type per file or grouped sensibly.
- Add tests for new scanner rules — every rule must have a positive and negative example.
- Keep the LLM input small. If you add data to the roast prompt, also add a corresponding cap.
- Preserve the cache key (`owner/repo@sha`). Any change here is a breaking change to the entire system.

### Don't
- Don't introduce a new infrastructure dependency without checking it's free and doesn't require a credit card.
- Don't move logic into the LLM that belongs in deterministic code (especially anything that affects the score).
- Don't soften the roast tone in prompt edits.
- Don't add Node-only dependencies — they won't run on Workers.
- Don't add private-repo / OAuth code paths.
- Don't write comments narrating what the code does. Comments are for *why*, and only when non-obvious.

---

## Common tasks, mapped to files

| Task | Touch these files |
|---|---|
| Add a new scanner rule | `src/scanners/<bucket>.ts`, `src/types.ts` (if new ruleId pattern), tests |
| Change point values | `src/scanners/*` (rule definitions), maybe `src/score.ts` if bucket caps change |
| Tweak the roast prompt | `src/roast.ts` |
| Change card layout | `src/card/render.ts` |
| Add a new API route | `src/index.ts` (or extract to `src/api/<name>.ts` first if routing grows) |
| Change rate limits | `src/ratelimit.ts` and constants near top |
| Add a new generator to the classifier | `src/scanners/classifier.ts`, plus add to `generator` union in `src/types.ts`, plus update roast prompt to reference it |

---

## Running locally

```bash
npm install
wrangler dev
```

Required Worker secrets (set with `wrangler secret put`):
- `OPENROUTER_API_KEY`
- `GITHUB_PAT` (any GitHub Personal Access Token with public-repo scope)

Required bindings (in `wrangler.jsonc`):
- D1 database: `DB`
- Durable Object: `SCAN_RUNNER` → class `ScanRunner`
- Static Assets: serves `frontend/dist`

---

## When in doubt

Read `SPEC.md` §12 (decisions log) — most "should I do X" questions are answered there with the reasoning.

If the spec is silent on something, default to: **make the cheapest, simplest choice that doesn't violate the core architectural principles at the top of this file.**
