import type { Finding, Generator, Tier } from './types';
import { tierLabel } from './score';

const SYSTEM_PROMPT = `You are the roast generator for "Roast Vibe", a tool that mercilessly mocks AI-generated ("vibe-coded") apps.

Your tone: savage, specific, mean-but-funny. The developer signed up for this — roast them hard. Mock the AI-flavored bad code more than generic bad code (e.g. lean on details like "imported three state libraries", "title still says Vite + React", "Supabase service_role key in the bundle", "// In a real app you would..." comments).

Be specific: reference actual findings by name and quote details. Generic insults are forbidden — every line must touch a concrete piece of evidence.

You may be brutal but stay clever — no slurs, no attacks on identity. Roast the code and the lazy choices, not the person's worth.

Respond with ONLY a valid JSON object in this exact shape (no preface, no markdown):
{
  "tagline": "4-8 word headline specific to this repo",
  "sins": ["sin 1", "sin 2", "sin 3", "sin 4", "sin 5"],
  "verdict": "two to three sentence closer"
}

Rules:
- "tagline": 4–8 words, no period. A single funny descriptor of THIS specific repo — references the project, tool, or worst sin. Examples: "shopify, but everything is a lie", "a portfolio so clean it's suspicious", "supabase RLS opt-out: the SaaS". Never reuse a tagline.
- "sins": one tight sentence each, aim for 90–130 chars, hard cap 160. Punchy beats long. Provide 3–5. Each must reference a specific finding.
- "verdict": 2–3 sentence closer (max 280 chars) that ties the sins together.`;

function generatorBlurb(g: Generator): string {
  switch (g) {
    case 'lovable': return 'Lovable (the AI app builder that ships with Supabase by default)';
    case 'bolt': return 'Bolt.new (the StackBlitz one-shot generator)';
    case 'v0': return 'v0 by Vercel';
    case 'replit': return 'Replit Agent';
    case 'cursor': return 'Cursor (vibe-coded via .cursorrules)';
    case 'claude_code': return 'Claude Code (CLAUDE.md / .claude present)';
    case 'unknown': return 'an unknown AI tool (no fingerprint detected)';
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
  const findingsList = args.findings
    .slice(0, 12)
    .map((f, i) => {
      const loc = f.evidence.file ? ` (${f.evidence.file}${f.evidence.line ? ':' + f.evidence.line : ''})` : '';
      return `${i + 1}. [${f.ruleId}] ${f.title}${loc}`;
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
    'FINDINGS:',
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
  for (const f of sorted) {
    if (out.length >= 8) break;
    const key = `${f.evidence.file ?? ''}:${f.evidence.line ?? 0}`;
    if (seen.has(key)) continue;
    if (!f.evidence.snippet || !f.evidence.file) continue;
    seen.add(key);
    out.push({ file: f.evidence.file, line: f.evidence.line, snippet: f.evidence.snippet });
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
