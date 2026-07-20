import { NextResponse } from 'next/server';
import { commit } from '@/lib/ledger';
import { ensureMandate, publishQuote, parties } from '@/lib/scenario';

export const dynamic = 'force-dynamic';

/**
 * Attempt a purchase: a supplier publishes a quote, then the agent tries to
 * commit it against the mandate.
 *
 * This is the single primitive the whole demo runs on. Both outcomes are
 * legitimate responses — a rejection is not an error path, it is the product
 * working, and the UI renders it as such. We deliberately return HTTP 200
 * with `ok: false` so that a refusal is data rather than a failure.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      supplier?: 'supplier' | 'unvetted';
      quantity?: number;
      unitPrice?: number;
      item?: string;
    };

    const quantity = Number(body.quantity ?? 200);
    const unitPrice = Number(body.unitPrice ?? 42);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ ok: false, error: 'quantity must be positive' }, { status: 400 });
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return NextResponse.json({ ok: false, error: 'unitPrice must be positive' }, { status: 400 });
    }

    const p = await parties();
    const supplierKey = body.supplier ?? 'supplier';
    const supplier = p[supplierKey];

    const mandate = await ensureMandate();
    const quote = await publishQuote(supplier, quantity, unitPrice, body.item);
    const result = await commit(mandate.contractId, quote.contractId, p.agent);

    return NextResponse.json({
      attempted: {
        supplier: supplierKey,
        quantity,
        unitPrice,
        amount: quantity * unitPrice,
      },
      result,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
