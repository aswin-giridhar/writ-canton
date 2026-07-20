'use client';

import { useCallback, useEffect, useState } from 'react';
import { SLIDES } from '@/lib/slides';

/**
 * The deck, as a page.
 *
 * Doubles as the frame source for the demo video: `?slide=N&bare=1` renders a
 * single slide with no chrome, which is what the recorder screenshots.
 */
export default function Deck() {
  const [i, setI] = useState(0);
  const [bare, setBare] = useState(false);

  // Read the deep-link params once on mount. Done here rather than with
  // useSearchParams so the route stays static and needs no Suspense boundary.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const n = Number(q.get('slide'));
    if (Number.isFinite(n) && n >= 1 && n <= SLIDES.length) setI(n - 1);
    setBare(q.get('bare') === '1');
  }, []);

  const go = useCallback((d: number) => {
    setI((p) => Math.min(SLIDES.length - 1, Math.max(0, p + d)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') go(1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const s = SLIDES[i];

  return (
    <main className={`deck${bare ? ' bare' : ''}`}>
      <article className="slide" key={i}>
        {i === 0 && <div className="slide-stamp">Refused</div>}
        <p className="slide-eyebrow">{s.eyebrow}</p>
        <h1 className="slide-title">{s.title}</h1>

        {s.body.length > 0 && (
          <div className="slide-body">
            {s.body.map((line, n) =>
              line.startsWith('> ') ? (
                <blockquote key={n}>{line.slice(2)}</blockquote>
              ) : line.startsWith('- ') ? (
                <p className="bullet" key={n}>
                  {renderEmphasis(line.slice(2))}
                </p>
              ) : (
                <p key={n}>{renderEmphasis(line)}</p>
              ),
            )}
          </div>
        )}

        {s.mono && <pre className="slide-mono">{highlight(s.mono)}</pre>}

        <footer className="slide-foot">
          <span className="slide-foot-mark">Writ</span>
          <span className="slide-foot-meta">Canton Devnet · live</span>
          <span className="slide-foot-num">
            {String(i + 1).padStart(2, '0')}
          </span>
        </footer>
        <div className="slide-progress" aria-hidden>
          <div style={{ width: `${((i + 1) / SLIDES.length) * 100}%` }} />
        </div>
      </article>

      {!bare && (
        <nav className="deck-nav">
          <button onClick={() => go(-1)} disabled={i === 0} aria-label="Previous slide">
            ←
          </button>
          <span className="deck-count">
            {String(i + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
          </span>
          <button
            onClick={() => go(1)}
            disabled={i === SLIDES.length - 1}
            aria-label="Next slide"
          >
            →
          </button>
          <a className="deck-link" href="/">
            Live demo →
          </a>
        </nav>
      )}
    </main>
  );
}

/**
 * Colour the verdicts in a mono block.
 *
 * The refusal is the argument the whole deck is making, so it carries the same
 * oxblood the app's stamp uses. Settlements get the bottle green. Everything
 * else stays ink — the point is that two words stand out, not that the block
 * becomes a syntax-highlighted rainbow.
 */
function highlight(block: string) {
  return block.split('\n').map((line, n) => {
    const cls = /REFUSED/.test(line)
      ? 'is-refused'
      : /SETTLED|\bok\b/.test(line)
        ? 'is-settled'
        : /^(OPERATOR|AGENT|LEDGER|PARTY)/.test(line)
          ? 'is-label'
          : undefined;
    return (
      <span className={cls} key={n}>
        {line}
        {'\n'}
      </span>
    );
  });
}

/** Minimal `**bold**` support so slide copy can carry emphasis. */
function renderEmphasis(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, n) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={n}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={n}>{part}</span>
    ),
  );
}
