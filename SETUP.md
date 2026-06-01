# Setup — Phase 0

One-time provisioning steps to do before Phase 1. Most of this is account creation; the rest is two `wrangler` commands.

## 1. Install dependencies

```bash
cd /Users/robeirtoma/roastvibe
npm install
```

This installs `wrangler` locally (no global install needed — use `npx wrangler …` or the `npm run` scripts).

## 2. Cloudflare account

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) — no credit card required for the Workers Free plan.
2. Log wrangler in:

   ```bash
   npx wrangler login
   ```

   Browser opens, authorize, done.

3. Verify:

   ```bash
   npx wrangler whoami
   ```

## 3. Create the D1 database

```bash
npx wrangler d1 create roastvibe
```

The output will include a `database_id`. **Copy that value** and paste it into `wrangler.jsonc` where it currently says `PLACEHOLDER_RUN_WRANGLER_D1_CREATE`.

Then run the initial migration locally and remotely:

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

## 4. Get an OpenRouter API key

1. Sign up at [openrouter.ai](https://openrouter.ai).
2. Create an API key in the dashboard.
3. Add credits — start with $5; that's ~250 scans on a Sonnet-class model.
4. Store the key as a Worker secret:

   ```bash
   npx wrangler secret put OPENROUTER_API_KEY
   ```

   Paste the key when prompted.

## 5. Get a GitHub Personal Access Token

This raises our GitHub API limit from 60 req/hour to 5,000 req/hour. It only needs **public_repo** scope.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens?type=beta) (fine-grained tokens).
2. Generate a new token. Permissions: **Public Repositories — Read-only**. No org access needed.
3. Store it:

   ```bash
   npx wrangler secret put GITHUB_PAT
   ```

## 6. Local development secrets

For `wrangler dev`, secrets come from `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars and paste your keys
```

`.dev.vars` is gitignored. **Never commit it.**

## 7. Smoke test

```bash
npm run dev
```

Then in another terminal:

```bash
curl http://localhost:8787/api/health
# {"ok":true}
```

If that returns `{"ok":true}`, Phase 0 is done.

## What's next

Phase 1: the scan pipeline. See `SPEC.md` §11.
