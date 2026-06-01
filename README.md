# Roast Vibe

A web tool that roasts AI-generated ("vibe-coded") apps.

Submit a public GitHub repo → get back a deterministic **Production Readiness Score** (0–100), a savage LLM-written roast, and a shareable score card built for Twitter/X and Reddit.

The roast is specific. Every line references a concrete finding — leaked OpenAI keys, Supabase `service_role` JWTs in client bundles, `// In a real app you would...` comments shipped to prod, `window.confirm()` dialogs as production UX, README files still saying *"Welcome to your Lovable project."*

> "checks the internet, leaks the secrets" — *roast.vibe on sindresorhus/is-online (95/100)*
> "v0 shipped John Doe to production" — *roast.vibe on an e-commerce dashboard (93/100)*
> "four .env files, zero shame" — *roast.vibe on a Supabase-backed SaaS (39/100)*

## Why it exists

AI codegen tools (Lovable, Bolt.new, v0, Replit Agent, Cursor on autopilot) ship apps that look finished but leak credentials, ignore Row Level Security, store JWTs in `localStorage`, and accumulate three state-management libraries that do the work of zero. Roast Vibe makes that funny *and* actionable — every roast is grounded in scanner findings the submitter can fix.

## Screenshots

<!-- Add screenshots in docs/screenshots/ and reference them here -->

| Landing | Result page | Share card |
|:---:|:---:|:---:|
| ![Landing](docs/screenshots/landing.png) | ![Result](docs/screenshots/result.png) | ![Card](docs/screenshots/card.png) |

## How it works

The architecture is a **funnel**: cheap deterministic work first, expensive LLM work last, on a minimal slice of code.

```
GitHub repo URL
      │
      ▼
[ 1. Fetch + filter ]      GitHub API. Skip node_modules/dist/lockfiles. Cap at ~50 files.
      │
      ▼
[ 2. Scan ]                ~25 deterministic rules across 5 buckets.
      │                    Each finding has severity + points.
      ▼
[ 3. Score ]               Sum capped deductions. Pure function. Same input → same score.
      │
      ▼
[ 4. Roast ]               LLM call (OpenRouter) gets findings + ~5–10 code snippets.
      │                    Returns: tagline, sins, verdict. ~8K input tokens, capped.
      ▼
[ 5. Render card ]         Satori + Resvg in the Worker. Two PNG variants.
      │
      ▼
Result page + cached forever by repo + commit SHA.
```

**The score is deterministic.** The LLM never touches it. Same repo at the same commit always produces the same number.

**The roast is the only paid step.** Cost is ~1–2 cents per scan on a Sonnet-class model via OpenRouter.

## Scanner buckets

| Bucket | Cap | Sample rules |
|---|---|---|
| **Secrets** | -50 | Committed `.env`, OpenAI/Anthropic/Stripe/AWS/GitHub keys, Supabase `service_role` JWTs in client bundles |
| **Auth & DB** | -30 | API routes with no auth check, SQL string concat, Supabase without RLS migrations, CORS wildcards, `localStorage` token storage |
| **AI slop** | -20 | `// In a real app you would...` comments, `mockUsers` shipped to prod, default `<title>Vite + React</title>`, `alert()` as production UI |
| **Tool classifier** | 0 (flavor only) | Lovable / Bolt.new / v0 / Replit Agent / Cursor / Claude Code fingerprinting |
| **Quality smells** | -10 | Multiple state libraries, async with no try/catch, mega-components |

Score = `max(0, 100 - sum_of_capped_deductions)`. Bucket caps ensure no single category can dominate.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Hosting | Cloudflare Workers (free plan) | $0 infra, edge-deployed |
| Long-running scan + state | Durable Objects (SQLite-backed) | One DO per `owner/repo`, gives caching + concurrency for free |
| Relational data | D1 (SQLite) | Newsletter signups, rate-limit counters, reports |
| Image storage | DO SQLite (PNG blobs) | R2 needs a credit card; DOs are free and fast enough |
| API framework | Hono | Native Workers runtime, minimal overhead |
| Frontend | React + Vite | Served as Worker static assets |
| Share card | Satori + `@resvg/resvg-wasm` | JSX → SVG → PNG, all inside the Worker |
| LLM | OpenRouter (default: Sonnet-class) | One key, multi-model A/B |

Infra cost: **$0**. Only paid line is OpenRouter LLM, with per-scan cost capped via prompt-size and output-token limits.

## Abuse controls

- **Repo size cap:** 5 MB enforced before any file fetch.
- **Per-IP daily quota:** 10 scans/day (configurable).
- **Global daily quota:** 500 scans/day circuit breaker.
- **Result caching:** keyed by `owner/repo`, second request to same repo is free.
- **Prompt-size cap:** LLM input hard-truncated at ~8K tokens.
- **Report-this-repo link:** any flag hides the public URL (data stays).

## Project layout

```
roastvibe/
├── src/
│   ├── index.ts                  Hono router, API + /r/:id with OG meta injection
│   ├── do/ScanRunner.ts          Durable Object: orchestrates the scan
│   ├── github.ts                 Repo metadata, tree, file fetchers, monorepo-aware
│   ├── scanners/                 Deterministic rules (one file per bucket)
│   ├── score.ts                  Findings → score, with bucket caps
│   ├── roast.ts                  OpenRouter call + prompt + snippet picker
│   ├── card/render.ts            Satori share-card rendering
│   ├── ratelimit.ts              D1-backed per-IP + global quotas
│   └── errors.ts                 Funny error catalog
├── frontend/                     React + Vite SPA (landing, loading, result)
├── migrations/                   D1 schema migrations
├── wrangler.jsonc                Workers config: DOs, D1, assets, vars
├── SPEC.md                       Full design doc + decisions log
└── AGENTS.md                     Context pack for AI assistants editing this repo
```

## Local development

```bash
# One-time setup
npm install
cd frontend && npm install && cd ..

# Provision (see SETUP.md for the full walkthrough)
npx wrangler login
npx wrangler d1 create roastvibe
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put GITHUB_PAT
cp .dev.vars.example .dev.vars   # paste keys here for local dev too
npm run db:migrate:local
npm run db:migrate:remote

# Dev (two terminals)
npm run dev               # Worker + DOs on http://localhost:8787
npm run dev:frontend      # Vite with HMR on http://localhost:5180

# Reset local state (wipes DOs + re-applies migrations)
npm run reset:local
```

## Deploy

```bash
npm run deploy
```

This builds the frontend, then `wrangler deploy`s the Worker. Default URL: `https://roastvibe.<your-subdomain>.workers.dev`. A custom domain is one Cloudflare dashboard click away once you own one.

## Status

MVP feature-complete. Calibrated against an initial test set of ~5 repos spanning clean libraries → vibe-coded SaaS → catastrophic-secrets case. Not yet deployed to production.

See [`SPEC.md`](./SPEC.md) for the full design + decisions log.
See [`AGENTS.md`](./AGENTS.md) if you're an AI assistant working in this codebase.

## Credits

Built solo over two weeks. Roast prose: OpenRouter (Sonnet-class). Card rendering: [Satori](https://github.com/vercel/satori) + [@resvg/resvg-wasm](https://github.com/yisibl/resvg-js). Edge runtime: Cloudflare Workers + Durable Objects.

The roast is harsh. The findings are real. Your dignity is not warrantied.
