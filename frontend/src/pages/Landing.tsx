import { useState } from 'react';
import { navigate } from '../App';

function parseRepoUrl(input: string): { owner: string; name: string } | null {
  const trimmed = input.trim();
  const m = trimmed.match(/github\.com[/:]+([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (m) return { owner: m[1], name: m[2] };
  const bare = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (bare) return { owner: bare[1], name: bare[2] };
  return null;
}

const CARDS = [
  { c: 'var(--accent)', t: 'SECRETS', d: 'OpenAI / Stripe / Supabase service_role JWTs leaked into client bundles' },
  { c: 'var(--accent-warm)', t: 'AUTH & DB', d: 'API routes with no auth, SQL string concat, RLS quietly disabled' },
  { c: 'var(--accent-bright)', t: 'AI SLOP', d: '"// In a real app you would…" comments shipped to production' },
  { c: 'var(--fg-dim)', t: 'FINGERPRINT', d: 'We detect Lovable, Bolt, v0, Replit, Cursor — and roast the tool' },
];

export default function Landing() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = parseRepoUrl(url);
    if (!parsed) {
      setError("That doesn't look like a GitHub URL. Try: github.com/owner/repo");
      return;
    }
    setBusy(true);
    navigate(`/r/pending--${parsed.owner.toLowerCase()}--${parsed.name.toLowerCase()}?url=${encodeURIComponent(url)}`);
  }

  return (
    <div className="page">
      <nav className="nav">
        <span className="logo">roast.vibe</span>
        <span className="logo" style={{ opacity: 0.4 }}>v0.1 — alpha</span>
      </nav>

      <div className="main">
        <div className="container">
          <section className="hero">
            <h1>
              Your <span className="hl-red">vibe-coded</span> app,<br />
              <span className="hl-orange">reviewed</span> <span className="hl-yellow">without mercy.</span>
            </h1>
            <p className="sub">
              Paste a public GitHub repo. We&apos;ll detect the AI tool that built it, find the leaked keys, the missing
              RLS, the three state libraries you forgot you imported — and hand you a Production Readiness Score plus a
              roast you didn&apos;t ask for.
            </p>

            <form className="submit-row" onSubmit={submit}>
              <input
                type="text"
                placeholder="github.com/owner/repo"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(null); }}
                disabled={busy}
                autoFocus
              />
              <button type="submit" disabled={busy || !url.trim()}>
                {busy ? 'Roasting…' : 'Roast it →'}
              </button>
            </form>
            <p className="hint">public repos only · ≤ 5 MB · we scan the source, not your dignity</p>

            {error && <div className="error">{error}</div>}

            <div className="cards-row">
              {CARDS.map((b) => (
                <div key={b.t} className="what-card">
                  <div className="tag" style={{ color: b.c }}>{b.t}</div>
                  <div className="desc">{b.d}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <footer className="footer">
        roast.vibe · all roasts are AI-generated, all sins are real
      </footer>
    </div>
  );
}
