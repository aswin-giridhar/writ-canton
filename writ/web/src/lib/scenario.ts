/**
 * The demo scenario: a company buying GPU compute through an autonomous
 * procurement agent.
 *
 * Cloud compute was chosen deliberately over a generic "widgets" example.
 * Anyone evaluating this already buys compute, already knows spot prices move,
 * and already understands why you would not want your supplier to learn your
 * maximum. The premise needs no explanation, which leaves the three minutes
 * of a demo free to show the actual mechanism.
 */
import {
  ensureParty,
  createMandate,
  createQuote,
  getMandates,
  getQuotes,
  getDeals,
} from './ledger';
import type { Contract, Mandate, Quote, Deal } from './types';

/**
 * Four parties, not five.
 *
 * `unvetted` does double duty: it is the counterparty missing from the
 * mandate's allowlist *and* the uninvolved third party who can see nothing.
 * That is deliberate. The shared Devnet validator authenticates every team
 * through one user, whose rights are a finite resource — another team hit
 * TOO_MANY_USER_RIGHTS at six parties. Spending four instead of five on
 * shared infrastructure costs us nothing: both demonstrations still hold.
 */
export const PARTY_HINTS = {
  principal: 'writ-northwind',
  agent: 'writ-agent',
  supplier: 'writ-hyperscale',
  unvetted: 'writ-unvetted',
} as const;

export type PartyRole = keyof typeof PARTY_HINTS;

export interface Parties {
  principal: string;
  agent: string;
  supplier: string;
  unvetted: string;
}

/** Display names, kept apart from ledger ids so the UI reads like a product. */
export const PARTY_LABELS: Record<PartyRole, string> = {
  principal: 'Northwind AI',
  agent: 'Procurement agent',
  supplier: 'Hyperscale Cloud',
  unvetted: 'Unvetted Broker',
};

let cached: Parties | null = null;

/**
 * Resolve the cast.
 *
 * On Devnet the parties already exist under the hackathon namespace, so we
 * compose their ids rather than allocating — allocating on every cold start
 * would litter a shared validator. Locally, with no namespace configured, we
 * allocate as before.
 */
export async function parties(): Promise<Parties> {
  if (cached) return cached;

  const ns = process.env.WRIT_PARTY_NAMESPACE;
  if (ns) {
    cached = {
      principal: `${PARTY_HINTS.principal}${ns}`,
      agent: `${PARTY_HINTS.agent}${ns}`,
      supplier: `${PARTY_HINTS.supplier}${ns}`,
      unvetted: `${PARTY_HINTS.unvetted}${ns}`,
    };
    return cached;
  }

  const [principal, agent, supplier, unvetted] = await Promise.all([
    ensureParty(PARTY_HINTS.principal),
    ensureParty(PARTY_HINTS.agent),
    ensureParty(PARTY_HINTS.supplier),
    ensureParty(PARTY_HINTS.unvetted),
  ]);
  cached = { principal, agent, supplier, unvetted };
  return cached;
}

/** Strip the `::fingerprint` suffix so the UI can show readable names. */
export function shortParty(p: string): string {
  return p.split('::')[0];
}

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const DAY = 86_400_000;

/**
 * Issue the standing mandate if none exists.
 *
 * The numbers are chosen so every bound is reachable inside a three-minute
 * demo: a single over-cap quote trips `perTxCap`, a $50/unit quote trips
 * `reservePrice`, and six legitimate purchases exhaust `maxTotalSpend`.
 */
export async function ensureMandate(): Promise<Contract<Mandate>> {
  const p = await parties();
  const existing = await getMandates(p.principal);
  if (existing.length > 0) return existing[0];

  await createMandate({
    principal: p.principal,
    agent: p.agent,
    purpose: 'Q3 GPU compute procurement',
    maxTotalSpend: '50000.0',
    perTxCap: '10000.0',
    reservePrice: '45.0',
    allowedCounterparties: [p.supplier],
    expiry: iso(30 * DAY),
    spentToDate: '0.0',
  });

  const created = await getMandates(p.principal);
  return created[0];
}

export async function publishQuote(
  supplier: string,
  quantity: number,
  unitPrice: number,
  item = 'A100 GPU-hours',
): Promise<Contract<Quote>> {
  const p = await parties();
  await createQuote({
    counterparty: supplier,
    principal: p.principal,
    agent: p.agent,
    item,
    quantity: String(quantity),
    unitPrice: unitPrice.toFixed(1),
    validUntil: iso(DAY),
  });

  const quotes = await getQuotes(p.agent);
  return quotes[quotes.length - 1];
}

/**
 * The ledger as seen by one party.
 *
 * Fetching this per-role is the entire privacy demonstration: the supplier's
 * view of `mandates` comes back empty, and it comes back empty because the
 * contract was never sent to that participant — not because we filtered it.
 */
export interface PartyView {
  role: PartyRole;
  party: string;
  name: string;
  mandates: Contract<Mandate>[];
  quotes: Contract<Quote>[];
  deals: Contract<Deal>[];
}

export async function viewAs(role: PartyRole): Promise<PartyView> {
  const p = await parties();
  const party = p[role];
  const [mandates, quotes, deals] = await Promise.all([
    getMandates(party),
    getQuotes(party),
    getDeals(party),
  ]);
  return { role, party, name: shortParty(party), mandates, quotes, deals };
}
