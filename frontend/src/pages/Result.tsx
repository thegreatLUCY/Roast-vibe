import { useEffect, useRef, useState } from 'react';
import { navigate } from '../App';

type Severity = 'cosmetic' | 'smell' | 'real_risk' | 'catastrophic';
type Tier = 'catastrophic' | 'vibe_coder_special' | 'surprisingly_functional' | 'production_adjacent';
type Generator = 'lovable' | 'bolt' | 'v0' | 'replit' | 'cursor' | 'claude_code' | 'unknown';

interface Finding {
  ruleId: string;
  bucket: string;
  severity: Severity;
  points: number;
  title: string;
  evidence: { file?: string; line?: number; snippet?: string };
}

interface ScanResult {
  scanId: string;
  repo: string;
  sha: string;
  defaultBranch: string;
  generator: Generator;
  findings: Finding[];
  score: number;
  tier: Tier;
  deductionsByBucket: Record<string, number>;
  roast: { tagline?: string; sins: string[]; verdict: string };
  createdAt: number;
}

const LOADING_MESSAGES = [
  'cloning the scene of the crime…',
  'opening package.json (deep breath)…',
  'counting state management libraries…',
  'sniffing every `process.env` for leaks…',
  'scanning for committed .env files…',
  'decoding JWTs in the bundle…',
  'searching for `useEffect` crimes…',
  'looking for "// in a real app you would…"',
  'checking Supabase migrations for RLS…',
  'measuring the largest component…',
  'cross-referencing the dummy data…',
  'consulting the roast model…',
  'sharpening the verdict…',
];

const TIER_LABEL: Record<Tier, string> = {
  catastrophic: 'CATASTROPHIC',
  vibe_coder_special: 'VIBE-CODER SPECIAL',
  surprisingly_functional: 'SURPRISINGLY FUNCTIONAL',
  production_adjacent: 'PRODUCTION-ADJACENT',
};

// Fallback only when the LLM doesn't provide a tagline; intentionally short.
const TIER_FALLBACK: Record<Tier, string> = {
  catastrophic: 'a catastrophe in three acts',
  vibe_coder_special: 'a working demo and many time bombs',
  surprisingly_functional: 'better than expected',
  production_adjacent: 'suspiciously competent',
};

const GENERATOR_LABEL: Record<Generator, string | null> = {
  lovable: 'Made with Lovable',
  bolt: 'Made with Bolt.new',
  v0: 'Made with v0',
  replit: 'Made with Replit Agent',
  cursor: 'Vibe-coded via Cursor',
  claude_code: 'Built with Claude Code',
  unknown: null,
};

export default function Result({ id }: { id: string }) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [stage, setStage] = useState<'submitting' | 'running' | 'done' | 'error'>('submitting');
  const [error, setError] = useState<string | null>(null);
  const [msgIndex, setMsgIndex] = useState(0);
  const [showReceipts, setShowReceipts] = useState(true);
  const [cardVariant, setCardVariant] = useState<'full' | 'score_only'>('full');
  const [email, setEmail] = useState('');
  const [emailState, setEmailState] = useState<'idle' | 'sent' | 'error'>('idle');
  const [reportState, setReportState] = useState<'idle' | 'sent'>('idle');
  const submittedRef = useRef(false);

  useEffect(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;

    const pendingMatch = id.match(/^pending--(.+)$/);
    const isPending = !!pendingMatch;

    async function load() {
      if (!isPending) {
        try {
          const r = await fetch(`/api/result/${id}`);
          if (r.status === 410) {
            setError('this roast has been pulled. probably for good reason.');
            setStage('error');
            return;
          }
          if (r.ok) {
            const j = await r.json();
            setResult(j);
            setStage('done');
            return;
          }
        } catch { /* fall through */ }
      }

      const params = new URLSearchParams(window.location.search);
      const urlParam = params.get('url');
      let url = urlParam;
      if (!url && pendingMatch) {
        const parts = pendingMatch[1].split('--');
        if (parts.length === 2) {
          url = `${parts[0]}/${parts[1]}`;
        }
      }
      if (!url) {
        setError('No repo URL provided.');
        setStage('error');
        return;
      }

      setStage('running');
      try {
        const r = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const j = await r.json();
        if (r.status === 410 || j?.error === 'REPORTED') {
          setError('this roast has been pulled. probably for good reason.');
          setStage('error');
          return;
        }
        if (!r.ok) {
          setError(j.message ?? j.error ?? 'Scan failed.');
          setStage('error');
          return;
        }
        const result: ScanResult = j.result;
        setResult(result);
        setStage('done');
        window.history.replaceState({}, '', `/r/${result.scanId}`);
      } catch (e: any) {
        setError(String(e?.message ?? e));
        setStage('error');
      }
    }

    load();
  }, [id]);

  useEffect(() => {
    if (stage !== 'running' && stage !== 'submitting') return;
    const t = setInterval(() => {
      setMsgIndex((i) => Math.min(i + 1, LOADING_MESSAGES.length - 1));
    }, 1400);
    return () => clearInterval(t);
  }, [stage]);

  if (stage === 'error') {
    return (
      <div className="page">
        <nav className="nav">
          <a href="/" className="logo" onClick={(e) => { e.preventDefault(); navigate('/'); }}>roast.vibe</a>
        </nav>
        <div className="main">
          <div className="container">
            <div className="error-stage">
              <div className="error-tag">▌ ROAST UNAVAILABLE</div>
              <div className="error-headline">we couldn&apos;t finish the roast.</div>
              <div className="error-detail">{error}</div>
              <div className="error-actions">
                <button className="share-btn" onClick={() => navigate('/')}>← try another repo</button>
              </div>
            </div>
          </div>
        </div>
        <footer className="footer">roast.vibe · all roasts are AI-generated, all sins are real</footer>
      </div>
    );
  }

  if (stage !== 'done' || !result) {
    return (
      <div className="page">
        <nav className="nav">
          <a href="/" className="logo" onClick={(e) => { e.preventDefault(); navigate('/'); }}>roast.vibe</a>
        </nav>
        <div className="main">
          <div className="container">
            <div className="loading-stage">
              <div className="label">▌ROASTING IN PROGRESS</div>
              <div className="repo">{decodeURIComponent(window.location.search.replace(/^\?url=/, '')) || id}</div>
              <div className="loading-stream">
                {LOADING_MESSAGES.slice(0, msgIndex + 1).map((m, i) => (
                  <span key={i} className={`line ${i < msgIndex ? 'done' : 'current'}`}>{m}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <footer className="footer">roast.vibe · all roasts are AI-generated, all sins are real</footer>
      </div>
    );
  }

  const generatorBadge = GENERATOR_LABEL[result.generator];

  return (
    <div className="page">
      <nav className="nav">
        <a href="/" className="logo" onClick={(e) => { e.preventDefault(); navigate('/'); }}>roast.vibe</a>
        <a href={`https://github.com/${result.repo}`} target="_blank" className="logo" style={{ opacity: 0.5 }}>
          github ↗
        </a>
      </nav>

      <div className="main">
        <div className="container">
          <div className="result">
            <div className="result-header">
              <div className="score-block">
                <div className={`score-num tier-${result.tier}`}>{result.score}</div>
                <div className="score-out-of">/ 100</div>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="tier-name">{TIER_LABEL[result.tier]}</div>
                <div className="tier-sub">"{result.roast.tagline || TIER_FALLBACK[result.tier]}"</div>
                <div className="repo-meta">
                  <a href={`https://github.com/${result.repo}`} target="_blank">
                    github.com/{result.repo}
                  </a>
                  <span style={{ opacity: 0.5 }}> · {result.sha.slice(0, 7)}</span>
                </div>
                {generatorBadge && (
                  <div className="generator-badge">⚠ {generatorBadge}</div>
                )}
              </div>
            </div>

            <div className="result-body">
              <section className="section">
                <h2>The Sins</h2>
                <ul className="sins">
                  {result.roast.sins.map((sin, i) => (
                    <li key={i} className="sin">
                      <span className="marker">0{i + 1}</span>
                      <span>{sin}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="section">
                <h2>The Verdict</h2>
                <div className="verdict-block">{result.roast.verdict}</div>

                <button
                  className="findings-toggle"
                  onClick={() => setShowReceipts(v => !v)}
                  style={{ marginTop: 16 }}
                >
                  {showReceipts ? '▾' : '▸'} the receipts ({result.findings.length})
                </button>
                {showReceipts && (
                  <div className="findings">
                    {result.findings.map((f, i) => (
                      <div key={i} className="finding-row">
                        <span className={`points sev-${f.severity}`}>-{f.points}</span>
                        <span>{f.title}</span>
                        <span className="file">{f.evidence.file ?? ''}{f.evidence.line ? `:${f.evidence.line}` : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="card-preview-row">
              <div className="card-preview">
                <img
                  key={cardVariant}
                  src={`/api/card/${result.scanId}/${cardVariant}.png`}
                  alt="share card"
                />
              </div>
              <div className="card-controls">
                <div className="variant-toggle">
                  <button
                    className={cardVariant === 'full' ? 'on' : ''}
                    onClick={() => setCardVariant('full')}
                  >full roast</button>
                  <button
                    className={cardVariant === 'score_only' ? 'on' : ''}
                    onClick={() => setCardVariant('score_only')}
                  >score only</button>
                </div>
                <div className="share-row">
                  <button
                    className="share-btn"
                    onClick={() => {
                      const text = `My vibe-coded app scored ${result.score}/100 on roast.vibe. ${TIER_LABEL[result.tier]}.`;
                      const url = window.location.href;
                      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
                    }}
                  >share on X →</button>
                  <button
                    className="share-btn secondary"
                    onClick={() => {
                      const url = window.location.href;
                      const title = `Roasted on roast.vibe: ${result.score}/100`;
                      window.open(`https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`, '_blank');
                    }}
                  >share on Reddit</button>
                  <button
                    className="share-btn secondary"
                    onClick={() => { navigator.clipboard.writeText(window.location.href); }}
                  >copy link</button>
                  <button className="share-btn secondary" onClick={() => navigate('/')}>roast another</button>
                </div>
                <form
                  className="newsletter"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!email.trim()) return;
                    setEmailState('idle');
                    try {
                      const r = await fetch('/api/newsletter', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ email, scanId: result.scanId }),
                      });
                      if (r.ok) setEmailState('sent');
                      else setEmailState('error');
                    } catch { setEmailState('error'); }
                  }}
                >
                  <input
                    type="email"
                    placeholder="get a weekly roast in your inbox"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setEmailState('idle'); }}
                    disabled={emailState === 'sent'}
                  />
                  <button type="submit" disabled={emailState === 'sent' || !email.trim()}>
                    {emailState === 'sent' ? 'in.' : emailState === 'error' ? 'try again' : 'subscribe'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="footer">
        <span>roast.vibe · all roasts are AI-generated, all sins are real</span>
        <span className="footer-dot">·</span>
        <button
          className="footer-link"
          disabled={reportState === 'sent'}
          onClick={async () => {
            if (reportState === 'sent') return;
            if (!confirm('Report this repo as not yours, abusive, or otherwise removable? The result will be hidden from the public URL.')) return;
            try {
              const r = await fetch('/api/report', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ scanId: result.scanId }),
              });
              if (r.ok) setReportState('sent');
            } catch { /* ignore */ }
          }}
        >
          {reportState === 'sent' ? 'reported · thank you' : 'report this repo'}
        </button>
      </footer>
    </div>
  );
}
