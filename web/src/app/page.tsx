'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Contract, Mandate } from '@/lib/types';

interface View {
  role: string;
  name: string;
  mandates: unknown[];
  quotes: unknown[];
  deals: unknown[];
}

interface State {
  ok: boolean;
  mandate: Contract<Mandate>;
  views: Record<string, View>;
  parties: Record<string, { full: string; name: string }>;
  error?: string;
}

interface Attempt {
  id: number;
  supplier: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  settled: boolean;
  reason?: string;
  at: string;
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const num = (s: string | undefined) => Number(s ?? 0);

const SUPPLIER_LABEL: Record<string, string> = {
  supplierA: 'Hyperscale Cloud',
  supplierB: 'Atlas Compute',
  rogue: 'Unvetted Broker',
};

/**
 * Presets are the demo script. Each trips a different bound, so a viewer can
 * walk every rejection path without typing numbers — and each label says what
 * the ledger will rule on, not what the button does.
 */
const PRESETS: { label: string; body: Record<string, unknown>; danger?: boolean }[] = [
  { label: 'Routine purchase · $8,400', body: { quantity: 200, unitPrice: 42 } },
  { label: 'Over per-transaction cap', body: { quantity: 300, unitPrice: 40 }, danger: true },
  { label: 'Above reserve price', body: { quantity: 100, unitPrice: 50 }, danger: true },
  {
    label: 'Unvetted counterparty',
    body: { quantity: 100, unitPrice: 40, supplier: 'rogue' },
    danger: true,
  },
  { label: 'Drain the mandate', body: { quantity: 240, unitPrice: 40 } },
];

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState(200);
  const [price, setPrice] = useState(42);
  const [supplier, setSupplier] = useState('supplierA');

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      const d = (await r.json()) as State;
      if (!d.ok) {
        setError(d.error ?? 'Ledger unreachable');
        return;
      }
      setState(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ledger unreachable');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const attempt = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const r = await fetch('/api/attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (d.error) {
          setError(String(d.error));
          return;
        }
        setAttempts((prev) => [
          {
            id: Date.now(),
            supplier: String(d.attempted.supplier),
            quantity: Number(d.attempted.quantity),
            unitPrice: Number(d.attempted.unitPrice),
            amount: Number(d.attempted.amount),
            settled: Boolean(d.result?.ok),
            reason: d.result?.reason,
            at: new Date().toISOString().slice(11, 19),
          },
          ...prev,
        ]);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Request failed');
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const m = state?.mandate.payload;
  const maxTotal = num(m?.maxTotalSpend);
  const spent = num(m?.spentToDate);
  const remaining = Math.max(0, maxTotal - spent);
  const pct = maxTotal > 0 ? Math.min(100, (spent / maxTotal) * 100) : 0;

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Canton · ledger-enforced agent authority</p>
          <h1 className="wordmark">Writ</h1>
          <p className="thesis">Authority is a contract, not a prompt.</p>
        </div>
        <div className="ledger-badge">
          <span className={`dot${error ? ' down' : ''}`} aria-hidden />
          {error ? 'Ledger unreachable' : 'Ledger connected'}
        </div>
      </header>

      <div className="columns">
        <div>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Mandate</h2>
              <span className="eyebrow">On-ledger</span>
            </div>
            <div className="panel-body">
              {m ? (
                <>
                  <div className="field">
                    <span className="field-tag">:20:</span>
                    <span className="field-value">{m.purpose}</span>
                  </div>
                  <div className="field">
                    <span className="field-tag">:50:</span>
                    <span className="field-value">
                      {state?.parties.principal.name} → {state?.parties.agent.name}
                    </span>
                  </div>
                  <div className="field">
                    <span className="field-tag">:34A:</span>
                    <span className="field-value">{money(maxTotal)} total authority</span>
                  </div>
                  <div className="field">
                    <span className="field-tag">:33B:</span>
                    <span className="field-value">{money(num(m.perTxCap))} per transaction</span>
                  </div>
                  <div className="field is-private">
                    <span className="field-tag">:71A:</span>
                    <span className="field-value">
                      ${num(m.reservePrice).toFixed(2)} reserve price / unit
                    </span>
                  </div>
                  <div className="field">
                    <span className="field-tag">:57A:</span>
                    <span className="field-value">
                      {m.allowedCounterparties.length} approved counterparties
                    </span>
                  </div>
                  <div className="field">
                    <span className="field-tag">:31E:</span>
                    <span className="field-value">expires {m.expiry.slice(0, 10)}</span>
                  </div>

                  <div className="envelope">
                    <div className="envelope-track">
                      <div className="envelope-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="envelope-legend">
                      <span>{money(spent)} committed</span>
                      <span>{money(remaining)} remaining</span>
                    </div>
                  </div>

                  <p className="private-note">
                    Shaded terms are visible to the principal and the agent only.
                    A supplier quoting into this mandate cannot read the reserve
                    price, so it cannot price against it.
                  </p>
                </>
              ) : (
                <div className="empty">{error ?? 'Reading mandate from ledger…'}</div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Who sees what</h2>
              <span className="eyebrow">Live query</span>
            </div>
            <div className="panel-body">
              <table className="visibility">
                <thead>
                  <tr>
                    <th>Party</th>
                    <th>Mandate</th>
                    <th>Deals</th>
                  </tr>
                </thead>
                <tbody>
                  {state
                    ? Object.entries(state.views).map(([role, v]) => (
                        <tr key={role}>
                          <td>{v.name}</td>
                          <td className={v.mandates.length ? 'sees' : 'blind'}>
                            {v.mandates.length ? v.mandates.length : '—'}
                          </td>
                          <td className={v.deals.length ? 'sees' : 'blind'}>
                            {v.deals.length ? v.deals.length : '—'}
                          </td>
                        </tr>
                      ))
                    : null}
                </tbody>
              </table>
              <p className="private-note">
                Each row is a separate query to the ledger as that party. A dash
                is not a hidden value — the contract was never delivered to that
                participant node.
              </p>
            </div>
          </section>
        </div>

        <div>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Transmission log</h2>
              <span className="eyebrow">
                {attempts.length} attempt{attempts.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="panel-body">
              {attempts.length === 0 ? (
                <div className="empty">
                  No purchases attempted yet. Send one below and watch the ledger rule on it.
                </div>
              ) : (
                <div className="log">
                  {attempts.map((a) => (
                    <article
                      key={a.id}
                      className={`transmission ${a.settled ? 'settled' : 'refused'}`}
                    >
                      {!a.settled && <div className="stamp">Refused</div>}
                      <div className="transmission-head">
                        <span>
                          {a.at} · {SUPPLIER_LABEL[a.supplier] ?? a.supplier}
                        </span>
                        <span className={`verdict ${a.settled ? 'settled' : 'refused'}`}>
                          {a.settled ? 'Settled' : 'Refused'}
                        </span>
                      </div>
                      <div>
                        :32A: {a.quantity.toLocaleString()} × A100 GPU-hours @ $
                        {a.unitPrice.toFixed(2)}
                      </div>
                      <div>:32B: {money(a.amount)}</div>
                      {a.reason && (
                        <div className="reason">
                          <span className="reason-label">Ledger refused this transaction</span>
                          {a.reason}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Instruct the agent</h2>
              <span className="eyebrow">Acting as the agent</span>
            </div>
            <div className="panel-body">
              <p className="hint">
                These commands are submitted by the agent itself. It can ask for
                anything; the mandate decides what actually settles.
              </p>
              <div className="controls">
                <div className="control">
                  <label htmlFor="supplier">Supplier</label>
                  <select
                    id="supplier"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                  >
                    <option value="supplierA">Hyperscale Cloud</option>
                    <option value="supplierB">Atlas Compute</option>
                    <option value="rogue">Unvetted Broker</option>
                  </select>
                </div>
                <div className="control">
                  <label htmlFor="qty">GPU-hours</label>
                  <input
                    id="qty"
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                    style={{ width: 110 }}
                  />
                </div>
                <div className="control">
                  <label htmlFor="price">Unit price</label>
                  <input
                    id="price"
                    type="number"
                    min={1}
                    step={0.5}
                    value={price}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    style={{ width: 110 }}
                  />
                </div>
                <button
                  disabled={busy}
                  onClick={() => attempt({ quantity: qty, unitPrice: price, supplier })}
                >
                  {busy ? 'Submitting…' : `Buy ${money(qty * price)}`}
                </button>
              </div>

              <div className="preset-row">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className={p.danger ? 'danger' : 'ghost'}
                    disabled={busy}
                    onClick={() => attempt(p.body)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      <footer className="footnote">
        <span>Canton JSON Ledger API v2</span>
        <span>Daml 3.4.11</span>
        <span>Bounds enforced on the participant node, not in the agent</span>
      </footer>
    </main>
  );
}
