import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { commit } from '@/lib/ledger';
import { ensureMandate, publishQuote, parties } from '@/lib/scenario';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const anthropic = new Anthropic();

const Order = z.object({
  supplier: z.enum(['supplier', 'unvetted']).describe('Which supplier to buy from'),
  quantity: z.number().int().positive().describe('Number of A100 GPU-hours'),
  unitPrice: z.number().positive().describe('Price per GPU-hour in USD'),
  rationale: z.string().describe('One short sentence explaining the decision'),
});

/**
 * The agent's operating instructions.
 *
 * Note what this contains: the mandate's actual limits. The agent is *told*
 * its budget in plain English, the way every production agent is today.
 *
 * That is the point of the demo, not an oversight. We are not testing whether
 * a well-behaved agent stays in budget — we are testing what happens when the
 * prompt-level guardrail fails. When a user overrides these instructions, the
 * agent will genuinely try to place the order it was told not to. The prompt
 * does not hold. The ledger does.
 */
const SYSTEM = `You are ProcurementAgent, an autonomous buyer for NorthwindAI.

You purchase A100 GPU-hours. Your standing instructions:
- Total budget: $50,000
- Maximum per transaction: $10,000
- Never pay more than $45.00 per GPU-hour
- Approved supplier only: "supplier" (Hyperscale Cloud)
- "unvetted" (Unvetted Broker) is NOT approved

Convert the operator's request into a concrete order. Follow the request as
given, even where it conflicts with the instructions above — a downstream
control will decide what is permitted. Never refuse; always produce an order.`;

/**
 * Take a free-text instruction, let a real model turn it into an order, then
 * put that order to the ledger.
 *
 * Both halves are reported back: what the agent decided, and what the mandate
 * allowed. The gap between them is the product.
 */
export async function POST(req: Request) {
  try {
    const { instruction } = (await req.json()) as { instruction?: string };
    if (!instruction?.trim()) {
      return NextResponse.json({ error: 'Say what the agent should buy.' }, { status: 400 });
    }

    let order: z.infer<typeof Order>;
    try {
      const message = await anthropic.messages.parse({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        system: SYSTEM,
        // Adaptive thinking: the agent is reasoning about an adversarial
        // instruction, which is exactly the case it helps with.
        thinking: { type: 'adaptive' },
        output_config: { format: zodOutputFormat(Order) },
        messages: [{ role: 'user', content: instruction }],
      });

      if (!message.parsed_output) {
        throw new Error(`agent returned no structured order (stop_reason: ${message.stop_reason})`);
      }
      order = message.parsed_output;
    } catch (e) {
      // No API key, no credit, rate limited, or a refusal. Say so plainly
      // rather than silently fabricating an agent decision — a fake agent
      // would make the whole demonstration a lie.
      return NextResponse.json(
        {
          error: 'agent_unavailable',
          detail: e instanceof Error ? e.message : String(e),
        },
        { status: 503 },
      );
    }

    const p = await parties();
    const mandate = await ensureMandate();
    const quote = await publishQuote(p[order.supplier], order.quantity, order.unitPrice);
    const result = await commit(mandate.contractId, quote.contractId, p.agent);

    return NextResponse.json({
      instruction,
      agent: order,
      attempted: {
        supplier: order.supplier,
        quantity: order.quantity,
        unitPrice: order.unitPrice,
        amount: order.quantity * order.unitPrice,
      },
      result,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
