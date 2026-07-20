/**
 * Domain types mirroring the Daml templates in `mandate-model`.
 *
 * Kept hand-written rather than generated: the generated TypeScript
 * bindings (`@daml/ledger`, `@daml/react`) are pinned to the 2.x line and
 * target the deprecated JSON API v1. Canton 3.x speaks JSON Ledger API v2,
 * so we talk to it directly and keep these types as the contract.
 */

/** Fully-qualified template id: `<packageId>:<module>:<entity>`. */
export type TemplateId = string;

export interface Mandate {
  principal: string;
  agent: string;
  purpose: string;
  maxTotalSpend: string;
  perTxCap: string;
  /** The number a counterparty would most like to know, and cannot see. */
  reservePrice: string;
  allowedCounterparties: string[];
  expiry: string;
  spentToDate: string;
}

export interface Quote {
  counterparty: string;
  principal: string;
  agent: string;
  item: string;
  quantity: string;
  unitPrice: string;
  validUntil: string;
}

export interface Deal {
  principal: string;
  counterparty: string;
  agent: string;
  item: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  settledAt: string;
}

/** An active contract as returned by the ledger, with its contract id. */
export interface Contract<T> {
  contractId: string;
  payload: T;
}

/**
 * Outcome of attempting to spend against a mandate.
 *
 * A rejection is not an application error — it is the ledger doing its job,
 * and the demo treats it as a first-class, expected result.
 */
export type CommitResult =
  | { ok: true; dealCid: string; mandateCid: string }
  | { ok: false; rejectedBy: 'ledger'; reason: string };

/** Which party's eyes we are viewing the ledger through. */
export type Viewpoint = 'principal' | 'agent' | 'counterparty';
