import { NextResponse } from 'next/server';
import { ensureMandate, viewAs, parties, shortParty } from '@/lib/scenario';

export const dynamic = 'force-dynamic';

/**
 * The full demo state: the mandate, plus the ledger as seen by each party.
 *
 * All four views are fetched independently from the ledger rather than
 * derived from one privileged read. That is the point — if we filtered a
 * single result set in application code, the privacy claim would be ours to
 * make. Fetching per-party makes it Canton's.
 */
export async function GET() {
  try {
    const mandate = await ensureMandate();
    const [principal, agent, supplier, unvetted] = await Promise.all([
      viewAs('principal'),
      viewAs('agent'),
      viewAs('supplier'),
      viewAs('unvetted'),
    ]);
    const p = await parties();

    return NextResponse.json({
      ok: true,
      mandate,
      views: { principal, agent, supplier, unvetted },
      parties: Object.fromEntries(
        Object.entries(p).map(([k, v]) => [k, { full: v, name: shortParty(v) }]),
      ),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
