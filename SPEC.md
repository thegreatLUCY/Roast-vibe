# Roast Vibe — Project Spec

> Source of truth for design decisions and build plan. Update this doc when decisions change; don't let it drift.

---

## 1. Product

**Roast Vibe** is a web tool that roasts AI-generated ("vibe-coded") apps. Submit a public GitHub repo, get back:

1. A **deterministic Production Readiness Score** (0–100) based on a rules-based scanner.
2. An **LLM-written roast** describing the sins in entertaining prose.
3. A **shareable score card** (PNG) designed to be posted to Twitter/X and Reddit.

The product is meme-first but substantively useful. The score must be defensible. The roast must be specific enough to be funny.

### Tone

No restraint. The dev is fair game. This is for vibe coders and they signed up for it the moment they submitted.

### Goals (in order)

1. Genuinely funny output that people *want* to post.
2. Concrete, defensible findings backing every score.
3. Zero recurring infrastructure cost.
4. Low LLM cost per scan (≤ $0.02 target).
5. Ship within 2 weeks, solo.

### Non-goals (for MVP)

- Private repo support.
- Multi-language UI (English only).
- Account system / user auth.
- Live URL scanning (deferred to v2).
- Multiple LLM ensemble. One model, one provider.

---

## 2. Input

**MVP:** Public GitHub repository URL.

- Reject private/missing repos with a funny error.
- Hard size cap: **5 MB repo size** (checked via GitHub metadata before any file fetch).
- Inner cap: only process the first **~50 "interesting" files** after filtering out `node_modules`, build artifacts, images, lockfile bodies, etc.

Future inputs (post-MVP): live URL (UI-only roast), paste-your-code box.

---

## 3. Architecture: the funnel

The single most important architectural principle: **cheap work first, expensive work last, on a minimal slice of code.**

```
[ Repo URL ]
     |
     v
[ Stage 1: Fetch + Filter ]         (GitHub API, free)
     |
     v
[ Stage 2: Deterministic Scanners ] (regex/AST rules, free, produces findings + score)
     |
     v
[ Stage 3: LLM Roast ]              (findings + ~5-10 snippets, OpenRouter, ~$0.01-0.02)
     |
     v
[ Stage 4: Share Card Render ]      (Satori in Worker, free)
     |
     v
[ Result page + cached forever by repo+SHA ]
```

**The score is computed in Stage 2.** The LLM never touches the score. Same repo at the same commit → same score, every time.

**The roast is written in Stage 3.** Input is the structured findings list plus a handful of strategically-picked code snippets (worst-hit lines from the scanners), not the whole repo.

---

## 4. Stack

| Layer | Choice | Why |
|---|---|---|
| Hosting | Cloudflare Workers (free plan) | No cost, no card, edge-deployed |
| Long-running scan state | Durable Objects, SQLite-backed | Free, one DO per `repo@SHA` gives caching + concurrency for free |
| Relational data | D1 (SQLite) | Newsletter signups, rate-limit counters, reports |
| Image storage | DO SQLite (PNG blobs) | R2 requires a card; DOs are free and adequate at our scale |
| API framework | Hono | Runs natively on Workers, minimal overhead |
| Frontend | React + Vite | Familiar, Worker Static Assets serves it |
| Share card render | Satori + Resvg-js | JSX → SVG → PNG, runs in the Workers runtime |
| LLM | OpenRouter (default: Sonnet-class) | One key, multi-model A/B, ~$0.015/roast |
| GitHub access | Unauthenticated tree fetch + a Personal Access Token for higher rate limits | 5K/hr with PAT vs 60/hr without |
| Domain | `*.workers.dev` for MVP; custom domain later | Custom domain is free to attach |

### Why this stack

- **Workers + DOs** is the only mainstream setup where a 30-second scan with progress streaming, caching, and global edge serving costs $0 at low volume and survives going viral on pennies.
- **R2 deliberately excluded** because it requires a credit card. PNG blobs live in the DO's SQLite storage instead.
- **OpenRouter** is the only line item with any cost.

---

## 5. Scoring rubric

~25 rules for MVP, organized in 5 buckets with per-bucket deduction caps.

### Bucket structure

| Bucket | Rule count | Cap |
|---|---|---|
| Secrets (catastrophic) | ~6 | -30 |
| Auth & DB sins | ~5 | -25 |
| AI-slop tells (the funny ones) | ~8 | -20 |
| Tool classifier (Lovable/Bolt/v0/Replit/Cursor) | ~5 | 0 (not scored, used for roast flavor) |
| Quality smells | ~4 | -10 |

`score = max(0, 100 - sum_of_capped_deductions)`

### Score tiers (drive card color + headline)

| Score | Tier | Card color |
|---|---|---|
| 0–25 | Catastrophic | Blood red |
| 26–50 | Vibe-Coder Special | Orange |
| 51–75 | Surprisingly Functional | Yellow |
| 76–100 | Production-Adjacent | Green |

### Seed rules (initial set)

**Secrets / Catastrophic (-10 to -20 each, capped at -30):**
- `.env*` committed with real-looking values
- OpenAI key (`sk-...`) in client bundle
- Anthropic key (`sk-ant-...`) in client bundle
- Stripe live key (`sk_live_...`) anywhere
- AWS access key + secret pair
- GitHub PAT (`ghp_...`, `github_pat_...`)
- Supabase `service_role` JWT in client-reachable code or `NEXT_PUBLIC_*` / `VITE_*` env var
- Hardcoded JWT signing secret

**Auth & DB sins (-4 to -12 each, capped at -25):**
- API routes touching DB with no auth call (`getServerSession`, `auth()`, `supabase.auth.getUser()`, etc.)
- Client-side-only route protection
- SQL via string concat / unsafe template literal
- `raw()` / `unsafe()` query with interpolation
- No Supabase RLS migrations despite using `@supabase/supabase-js`
- CORS wildcard with credentials
- `localStorage` token storage

**AI-slop tells (-1 to -4 each, capped at -20):**
- `// In a real app you would...` / `// This is a basic implementation` comments
- `// ...rest of code remains the same` (means paste was incomplete)
- `TODO: add auth` / `TODO: implement` density per 1K LoC
- Placeholder strings shipped (`Lorem ipsum`, `John Doe`, `jane@example.com`, `Acme Inc`)
- `mockUsers` / `dummyData` / `fakeProducts` referenced from rendered components
- Default `<title>Vite + React</title>` / `Create Next App` / `lovable-generated-project`
- README starts with `# Welcome to your <Tool> project`
- `alert()` / `confirm()` used as production UI
- Emoji-laden `console.log` left in (`'🚀 Starting...'`, etc.)

**Tool classifier (no point impact, sets roast flavor):**
- Lovable: `src/integrations/supabase/client.ts` + shadcn + `lovable-tagger`
- Bolt.new: exact `vite + react + lucide + tailwind + eslint-plugin-react-refresh` set, no router, no tests
- v0: `components.json` + `components/ui/` shadcn primitives + `app/` router + `geist`
- Replit Agent: `.replit`, `replit.nix`, `@neondatabase/serverless` + drizzle + express triad
- Cursor / Claude Code: `.cursorrules`, `.cursor/rules/`, `CLAUDE.md`, `.claude/`

**Quality smells (-1 to -3 each, capped at -10):**
- Two+ state libs (redux + zustand + jotai)
- Two+ date libs (moment + date-fns)
- Async route handler with no try/catch and no `.catch()`
- React component file >500 LoC with >8 `useState` calls

> **Calibration rule:** prefer 15 rock-solid rules over 25 noisy ones. False positives kill the joke.

---

## 6. The roast (LLM stage)

**Model:** OpenRouter, default a Sonnet-class model (Claude Sonnet 4.6 or 4.7). Behind a config flag for easy A/B.

**Prompt input:**
- The findings list (structured: rule name, severity, evidence/line refs).
- 5–10 worst-offender code snippets (the actual leaked-key line, the worst function, etc.).
- The detected generator tool (Lovable/Bolt/v0/etc.) if any.
- The score and tier.

**Prompt output:** sectioned roast.
- **THE SINS** — short bulletted takedown of the top 3–5 findings.
- **THE VERDICT** — 2–3 sentence closing paragraph that lands the joke.

**Constraints:**
- Input capped at ~8K tokens. If we'd exceed, drop lowest-severity findings first.
- Output capped at ~800 tokens.
- Tone instructions: savage, specific, no restraint on the dev. Mock the *AI-flavored* bad code more than generic bad code.

---

## 7. Share card

**Format:** 1200×630 PNG (works for Twitter `summary_large_image` and Reddit).

**Two variants per scan, both stored in the DO:**
- **Full card:** score + tier + top sins + verdict + classifier badge + submitter handle.
- **Score-only card:** score + tier + teaser link, for users who don't want to share the full roast.

**Renderer:** Satori (JSX → SVG) + Resvg-js (SVG → PNG), both running natively in the Worker.

**OG meta tags** on `/r/:id` result page reference the PNG so social unfurls work automatically. This is the viral mechanic — get it right.

### Card layout (target)

```
roastvibe.xyz                                     Made with Lovable
─────────────────────────────────────────────────────────────────
github.com/owner/repo

┌─────────┐
│   23    │   CATASTROPHIC
│  /100   │   "Surprisingly, still deployed."
└─────────┘

THE SINS
🔥  OpenAI key in client bundle          -15
💀  Supabase RLS disabled                -12
🤡  README still says "Welcome to        -2
    your Lovable project"

THE VERDICT
You imported three state management libs and used
none of them. Your useEffect deps array is a cry
for help.

                                       roasted @username
```

---

## 8. Caching & idempotency

- **DO ID = `${owner}/${repo}@${sha}`.** Same input → same DO → same cached result + PNGs.
- **TTL: indefinite.** Repos at a given SHA don't change.
- Newer SHAs trigger a fresh scan (a new DO instance).

This gives caching, per-repo serialization, and progress-streaming infrastructure in one primitive.

---

## 9. Abuse & cost controls

| Layer | Mechanism | Defends against |
|---|---|---|
| 1. Repo size cap | GitHub metadata size check before fetch | Huge-repo attack |
| 2. Result caching | DO keyed by `repo@SHA` | Repeat submissions |
| 3. Rate limits (D1) | 10 scans/IP/day, 1 scan/repo/24h, 500 scans/day global | Pile-on, script kiddie |
| 4. Edge rate limit | Cloudflare rule: 5 req/min on `POST /scan` per IP | Coarse front line |
| 5. LLM input cap | Hard 8K-token prompt limit, drop low-severity findings first | Cost tail risk |
| 6. LLM output cap | 800 max output tokens | Cost tail risk |
| 7. Global daily cap | Circuit breaker; UI shows "we got roasted into oblivion" page | Runaway costs |

**Light moderation:**
- "Report this repo" link on each result page; flagged results hide the public URL (DO data stays).
- Public repos only. Submitter handle (if given) shown on result page.

---

## 10. UX flow

1. **Landing.** Hero. Paste GitHub URL. Show 3–5 funny pre-scanned example results.
2. **Submitting.** Loading screen with rotating fake-progress messages ("Checking for committed secrets…", "Counting state management libraries…", "Decoding Supabase JWTs…", "Searching for `useEffect` crimes…"). Polled status under the hood.
3. **Result page.** Score, tier, sins, verdict, classifier badge. Card preview. Toggle: full card vs. score-only. Share buttons (Twitter, Reddit, copy link). Handle capture + newsletter signup as soft asks below the fold.
4. **Shared link → unfurls with OG card.** Click goes to the same result page.

---

## 11. Phased build order

### Phase 0 — Setup (½ day)
- Cloudflare account, `wrangler` installed
- Workers project with Hono, D1 binding, DO binding
- OpenRouter API key as Worker secret
- GitHub PAT as Worker secret
- Pick `*.workers.dev` subdomain

### Phase 1 — Scan pipeline (days 1–4)
- `POST /scan` endpoint + URL/size validation
- `ScanRunner` DO: GitHub tree + file fetch, scanner runner, score calc, OpenRouter call, result storage
- Scanner rules (~25, prioritized by bucket)
- `GET /result/:id` returns cached JSON
- Test end-to-end with curl

### Phase 2 — Frontend + share card (days 5–9)
- React + Vite frontend served as Worker Assets
- Landing, loading, result pages
- Fake-progress UI (this is brand, invest in it)
- Satori-rendered share cards (both variants), stored in DO
- OG meta tags
- Handle + newsletter capture in D1

### Phase 3 — Abuse controls + polish (days 10–12)
- D1-backed rate limiter
- Cloudflare edge Rate Limiting rule
- Global daily cap with funny "tapped out" page
- Error states for every failure mode, each with a funny message
- Report-repo link
- Copy pass on every string

### Phase 4 — Launch (days 13–14)
- Custom domain (optional)
- Calibration: scan 20+ known repos, tune point values if scores feel wrong
- Seed leaderboard with 5–10 pre-scanned funny repos
- Soft launch (friends), then Reddit + Twitter

---

## 12. Decisions log (so future-me knows why)

- **GitHub repo only for input** — only input where we can actually deliver "real issues." Live URL deferred.
- **Public repos only** — avoids OAuth + reduces liability around leaked secrets.
- **Deterministic score, LLM-only-on-roast** — defensibility + shareability. Same repo → same score, forever.
- **No email gate** — virality > data collection. Soft asks only.
- **OpenRouter, not direct Anthropic** — multi-model A/B without rewriting code; small markup acceptable.
- **No R2** — requires a credit card. PNGs in DO SQLite storage instead.
- **Workers Static Assets, not Pages** — simpler one-project mental model.
- **Polling + fake-progress, not WebSocket** — simpler MVP; the fake messages are funnier anyway.
- **DOs SQLite-backed only** — what the free plan supports, also the modern default.

---

## 13. Open questions / decide-during-build

- Final wording for score tier names (Catastrophic / Vibe-Coder Special / etc. — workshop during Phase 3 copy pass).
- Exact point values per rule — start with the seed values above, calibrate by scanning known repos.
- Whether the "Made with Lovable" badge ever gets pushback from the tool companies. Address if it happens; don't preempt.
- Leaderboard or not on landing page. Lean yes for launch (content) but cut if it costs more than half a day.
