import type { Finding, Generator, Tier } from './types';
import { tierLabel } from './score';

const SYSTEM_PROMPT = `You are the roast generator for "Roast Vibe", a tool that mercilessly mocks AI-generated ("vibe-coded") apps.

Your tone: savage, specific, mean-but-funny. The developer signed up for this — roast them hard. Mock the AI-flavored bad code more than generic bad code (e.g. lean on details like "imported three state libraries", "title still says Vite + React", "Supabase service_role key in the bundle", "// In a real app you would..." comments).

Be specific: reference actual findings by name and quote details. Generic insults are forbidden — every line must touch a concrete piece of evidence.

You may be brutal but stay clever — no slurs, no attacks on identity. Roast the code and the lazy choices, not the person's worth.

CRITICAL — DO NOT EMBELLISH:
- Treat each finding as a LITERAL claim. Do not infer anything beyond what the title states.
- If a finding says ".gitignore does not list .env (preventive — no .env file is committed)", you must NOT write "secrets are leaked", "front door open", or anything implying credentials exist. The repo has no .env file.
- Do not promote a 'preventive' or 'smell' or 'cosmetic' finding to a catastrophic one in prose. Match the prose to the finding's actual severity.
- If you have very few findings, do NOT manufacture missing details — write fewer, tighter sins instead of inflating what's there.
- Tone must scale with score (see TONE GUIDANCE in the user message).

Respond with ONLY a valid JSON object in this exact shape (no preface, no markdown):
{
  "tagline": "4-8 word headline specific to this repo",
  "sins": ["sin 1", "sin 2", "sin 3", "sin 4", "sin 5"],
  "verdict": "two to three sentence closer"
}

Rules:
- "tagline": 4–8 words, no period. A single funny descriptor of THIS specific repo — references the project, tool, or worst sin. Examples: "shopify, but everything is a lie", "a portfolio so clean it's suspicious", "supabase RLS opt-out: the SaaS". Never reuse a tagline.
- "sins": one tight sentence each, aim for 90–130 chars, hard cap 160. Punchy beats long. Provide 3–5. Each must reference a specific finding. NEVER restate facts not in the findings list.
- "verdict": 2–3 sentence closer (max 280 chars) that ties the sins together. Must match the tier's tone.`;

function generatorBlurb(g: Generator): string {
  switch (g) {
    case 'lovable': return 'Lovable (the AI app builder that ships with Supabase by default)';
    case 'bolt': return 'Bolt.new (the StackBlitz one-shot generator)';
    case 'v0': return 'v0 by Vercel';
    case 'replit': return 'Replit Agent';
    case 'cursor': return 'Cursor (vibe-coded via .cursorrules)';
    case 'claude_code': return 'Claude Code (CLAUDE.md / .claude present)';
    case 'codex': return 'Codex (OpenAI coding agent / AGENTS.md-style workflow)';
    case 'unknown': return 'an unknown AI tool (no fingerprint detected)';
  }
}

function toneGuidance(tier: Tier): string {
  switch (tier) {
    case 'catastrophic':
      return 'Score is catastrophic. The repo has serious, real issues — eviscerate. The findings are damning; trust them.';
    case 'vibe_coder_special':
      return 'Score is poor. Multiple real problems. Roast hard but accurately — match the severity of each finding.';
    case 'surprisingly_functional':
      return 'Score is mid-tier. Roast the sins as the cracks in an otherwise functional repo. Do not catastrophize smells.';
    case 'production_adjacent':
      return 'Score is solid (76–89). Most things are right. Roast the remaining sins like easter eggs — concede the rest is clean. No false catastrophe.';
    case 'suspiciously_clean':
      return 'Score is 90+. This repo is genuinely good. Roast the last 1–3 nitpicks as if you are reaching. Acknowledge it. Tone is "tough audience reluctantly impressed" — never imply secrets leaked, never imply the repo is broken.';
  }
}

function buildUserPrompt(args: {
  repo: string;
  score: number;
  tier: Tier;
  generator: Generator;
  findings: Finding[];
  snippets: { file: string; line?: number; snippet: string }[];
}): string {
  // Dedupe by ruleId — same rule firing across many files shouldn't dominate.
  // Keep the highest-points instance and a count.
  const byRule = new Map<string, { rep: Finding; count: number }>();
  for (const f of args.findings) {
    const existing = byRule.get(f.ruleId);
    if (!existing) {
      byRule.set(f.ruleId, { rep: f, count: 1 });
    } else {
      existing.count += 1;
      if (f.points > existing.rep.points) existing.rep = f;
    }
  }
  const deduped = [...byRule.values()].sort((a, b) => b.rep.points - a.rep.points);

  const findingsList = deduped
    .slice(0, 14)
    .map((entry, i) => {
      const f = entry.rep;
      const loc = f.evidence.file ? ` (${f.evidence.file}${f.evidence.line ? ':' + f.evidence.line : ''})` : '';
      const more = entry.count > 1 ? ` (+${entry.count - 1} more file${entry.count > 2 ? 's' : ''})` : '';
      return `${i + 1}. [${f.ruleId}] severity=${f.severity} — ${f.title}${loc}${more}`;
    })
    .join('\n');

  const snippetsBlock = args.snippets
    .slice(0, 8)
    .map(s => `--- ${s.file}${s.line ? ':' + s.line : ''} ---\n${s.snippet}`)
    .join('\n\n');

  return [
    `Repo: ${args.repo}`,
    `Score: ${args.score}/100 (${tierLabel(args.tier)})`,
    `Detected generator: ${generatorBlurb(args.generator)}`,
    '',
    `TONE GUIDANCE: ${toneGuidance(args.tier)}`,
    '',
    'FINDINGS (deduped — each line is one rule; "+N more files" means the same rule fired elsewhere):',
    findingsList || '(no findings — somehow)',
    '',
    'EVIDENCE SNIPPETS:',
    snippetsBlock || '(no snippets)',
  ].join('\n');
}

export async function generateRoast(
  args: Parameters<typeof buildUserPrompt>[0],
  env: { OPENROUTER_API_KEY: string; OPENROUTER_MODEL: string; MAX_LLM_OUTPUT_TOKENS: string },
): Promise<{ tagline: string; sins: string[]; verdict: string }> {
  const userPrompt = buildUserPrompt(args);

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://roastvibe.workers.dev',
      'X-Title': 'Roast Vibe',
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: Number(env.MAX_LLM_OUTPUT_TOKENS) || 800,
      temperature: 0.85,
      response_format: { type: 'json_object' },
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`OPENROUTER_ERROR_${r.status}: ${text.slice(0, 200)}`);
  }

  const j = await r.json() as any;
  const content = j.choices?.[0]?.message?.content ?? '';
  let parsed: { tagline?: string; sins: string[]; verdict: string };
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('OPENROUTER_INVALID_JSON');
    parsed = JSON.parse(m[0]);
  }

  if (!Array.isArray(parsed.sins) || typeof parsed.verdict !== 'string') {
    throw new Error('OPENROUTER_INVALID_SHAPE');
  }

  const tagline =
    typeof parsed.tagline === 'string' && parsed.tagline.trim()
      ? parsed.tagline.trim().replace(/[.!?]+$/, '')
      : ''; // empty → UI falls back to nothing rather than a generic line

  return { tagline, sins: parsed.sins, verdict: parsed.verdict };
}

export function pickSnippets(findings: Finding[]): { file: string; line?: number; snippet: string }[] {
  const out: { file: string; line?: number; snippet: string }[] = [];
  const seen = new Set<string>();
  // Prefer catastrophic + real_risk first, then by points
  const sorted = [...findings].sort((a, b) => {
    const sev = sevRank(b.severity) - sevRank(a.severity);
    if (sev !== 0) return sev;
    return b.points - a.points;
  });
  // Dedupe by ruleId at the snippet layer too — same rule firing in 8 files shouldn't yield 8 snippets.
  const ruleSeen = new Set<string>();
  for (const f of sorted) {
    if (out.length >= 8) break;
    if (ruleSeen.has(f.ruleId)) continue;
    const key = `${f.evidence.file ?? ''}:${f.evidence.line ?? 0}`;
    if (seen.has(key)) continue;
    // Real snippet present → use it.
    if (f.evidence.snippet && f.evidence.file) {
      seen.add(key);
      ruleSeen.add(f.ruleId);
      out.push({ file: f.evidence.file, line: f.evidence.line, snippet: f.evidence.snippet });
      continue;
    }
    // Synthesize a minimal snippet for findings without one (e.g. package.json based).
    if (f.evidence.file) {
      const synth = `[${f.severity}] ${f.title}`;
      seen.add(key);
      ruleSeen.add(f.ruleId);
      out.push({ file: f.evidence.file, snippet: synth });
    }
  }
  return out;
}

function sevRank(s: Finding['severity']): number {
  switch (s) {
    case 'catastrophic': return 4;
    case 'real_risk': return 3;
    case 'smell': return 2;
    case 'cosmetic': return 1;
  }
}
