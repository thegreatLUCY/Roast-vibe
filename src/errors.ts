/**
 * Funny, specific error messages keyed off error codes thrown anywhere in the pipeline.
 * Keep the keys stable — the frontend may show different art per code.
 */

export interface ErrorPayload {
  error: string;
  message: string;
  status: number;
}

export function errorFromCode(code: string, detail?: string): ErrorPayload {
  switch (code) {
    case 'MISSING_URL':
      return { error: code, status: 400, message: 'Paste a GitHub URL first. We can\'t roast nothing — that\'s called therapy.' };

    case 'BAD_URL':
      return { error: code, status: 400, message: 'That\'s not a GitHub URL. We tried.' };

    case 'REPO_NOT_FOUND':
      return { error: code, status: 404, message: 'That repo is either private, deleted, or never existed. Probably the third one.' };

    case 'REPO_PRIVATE':
      return { error: code, status: 403, message: 'That repo is private. We don\'t peek without invitation. Also, we\'d be liable.' };

    case 'REPO_TOO_LARGE':
      return {
        error: code,
        status: 413,
        message: detail
          ? `Your repo is ${detail}. We roast vibe-coded apps here, not the Linux kernel. Come back when you\'ve vibed harder.`
          : 'That repo is too big for us. Try a smaller one.',
      };

    case 'GITHUB_RATE_LIMITED':
      return { error: code, status: 502, message: 'GitHub is throttling our requests. Give it a few minutes and try again.' };

    case 'OPENROUTER_ERROR':
    case 'OPENROUTER_INVALID_JSON':
    case 'OPENROUTER_INVALID_SHAPE':
      return { error: code, status: 502, message: 'The roast model is having a moment. Try again — we\'ll probably forgive your code this time.' };

    case 'RATE_LIMIT_IP':
      return { error: code, status: 429, message: 'You\'ve roasted enough repos today. The bell rang. Try again tomorrow.' };

    case 'RATE_LIMIT_GLOBAL':
      return { error: code, status: 429, message: 'We\'ve been roasted into oblivion today. Even we have limits. Come back tomorrow.' };

    case 'SCAN_FAILED':
    default:
      return { error: code, status: 500, message: detail ?? 'Something broke. Even we\'re embarrassed.' };
  }
}

/**
 * Map any thrown Error message to one of our error codes (best-effort).
 */
export function errorFromException(e: unknown): ErrorPayload {
  const msg = String((e as any)?.message ?? e);
  if (msg.startsWith('REPO_NOT_FOUND')) return errorFromCode('REPO_NOT_FOUND');
  if (msg.startsWith('REPO_PRIVATE')) return errorFromCode('REPO_PRIVATE');
  if (msg.startsWith('GITHUB_RATE_LIMITED')) return errorFromCode('GITHUB_RATE_LIMITED');
  if (msg.startsWith('OPENROUTER_')) return errorFromCode('OPENROUTER_ERROR', msg);
  if (msg.startsWith('GITHUB_API_ERROR')) return { error: 'GITHUB_API_ERROR', status: 502, message: 'GitHub is misbehaving. Try again.' };
  return errorFromCode('SCAN_FAILED', msg);
}
