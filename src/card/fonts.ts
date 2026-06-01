/**
 * Lazy-load Inter font weights as TTF (Satori does not support WOFF2).
 * Cached in a module-level Map so each isolate fetches once.
 *
 * Source: rsms/inter GitHub repo, served via jsDelivr.
 */
const cache = new Map<string, ArrayBuffer>();

// rsms/inter ships individual weight TTFs in docs/font-files/.
// jsDelivr mirrors the repo at cdn.jsdelivr.net/gh/<user>/<repo>@<ref>/<path>.
// @fontsource/inter ships WOFF v1 (and WOFF2). Satori supports WOFF v1.
const URLS: Record<number, string> = {
  400: 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-400-normal.woff',
  700: 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-700-normal.woff',
  900: 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-900-normal.woff',
};

export async function loadInter(weight: 400 | 700 | 900): Promise<ArrayBuffer> {
  const key = `inter-${weight}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url = URLS[weight];
  if (!url) throw new Error(`FONT_WEIGHT_UNSUPPORTED_${weight}`);

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`FONT_FETCH_${resp.status}`);

  const buf = await resp.arrayBuffer();
  cache.set(key, buf);
  return buf;
}
