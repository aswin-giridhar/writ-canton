/**
 * Canton JSON Ledger API v2 client.
 *
 * Every request shape here was confirmed against a live Canton 3.4.11
 * participant rather than copied from documentation. That mattered: the
 * widely-referenced TypeScript bindings (`@daml/ledger`, `@daml/react`) are
 * pinned to the 2.x line and speak the deprecated JSON API v1, which fails
 * against Canton 3.x in ways that look like auth errors.
 *
 * The only difference between a local sandbox and the Canton Devnet
 * validator is the base URL and a bearer token — both read from the
 * environment, so deployment is configuration, not code.
 */
import type { Contract, Mandate, Quote, Deal, CommitResult } from './types';

const BASE = process.env.LEDGER_BASE_URL ?? 'http://localhost:7575';
const USER_ID = process.env.LEDGER_USER_ID ?? 'writ';

/**
 * Bearer token, minted on demand.
 *
 * Devnet access tokens live for 8 hours. A token pasted into an environment
 * variable would therefore work on the day it was set and fail silently
 * afterwards — precisely when someone else opens the link. So we run the
 * client-credentials grant ourselves and re-mint at 80% of the token's life.
 *
 * `LEDGER_TOKEN` is still honoured as an override for local experiments.
 */
const STATIC_TOKEN = process.env.LEDGER_TOKEN ?? '';
const OIDC_TOKEN_URL = process.env.OIDC_TOKEN_URL ?? '';
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? '';
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? '';
const OIDC_AUDIENCE = process.env.OIDC_AUDIENCE ?? OIDC_CLIENT_ID;
const OIDC_SCOPE = process.env.OIDC_SCOPE ?? 'daml_ledger_api';

let cachedToken: { value: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

async function mintToken(): Promise<string> {
  const res = await fetch(OIDC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: OIDC_CLIENT_ID,
      client_secret: OIDC_CLIENT_SECRET,
      audience: OIDC_AUDIENCE,
      scope: OIDC_SCOPE,
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`token grant failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('token grant returned no access_token');

  const lifetime = (body.expires_in ?? 28_800) * 1000;
  cachedToken = { value: body.access_token, expiresAt: Date.now() + lifetime * 0.8 };
  return body.access_token;
}

/** A valid bearer token, re-minted when the cached one is close to expiry. */
async function token(): Promise<string> {
  if (STATIC_TOKEN) return STATIC_TOKEN;
  if (!OIDC_TOKEN_URL || !OIDC_CLIENT_ID) return '';
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  // Collapse concurrent misses into one grant.
  inFlight ??= mintToken().finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Package id of `mandate-model`. Changes whenever the Daml source changes,
 * so it is configurable rather than hard-coded — a redeploy to Devnet will
 * produce a different id.
 */
export const PACKAGE_ID =
  process.env.MANDATE_PACKAGE_ID ??
  'a4f6a9b04d0bbbcaf756e21eea0818013213d35547d38708ab21e541b3fb7671';

/** Daml package name, used for query filters. See QUERY_TEMPLATES. */
const PACKAGE_NAME = process.env.MANDATE_PACKAGE_NAME ?? 'mandate-model';

/**
 * Template ids for *commands*. These take the package-id form.
 */
export const TEMPLATES = {
  mandate: `${PACKAGE_ID}:Writ.Mandate:Mandate`,
  quote: `${PACKAGE_ID}:Writ.Mandate:Quote`,
  deal: `${PACKAGE_ID}:Writ.Mandate:Deal`,
} as const;

/**
 * Template ids for *queries*, which are not the same thing.
 *
 * Canton resolves `TemplateFilter` by package *name* (`#name:Module:Entity`)
 * so that contracts created by an earlier version of a package still match a
 * filter written against a later one. Passing a package id here returns zero
 * rows — silently, with HTTP 200 — even though the contracts exist and the
 * create succeeded. Measured against Devnet: package-id form matched 0,
 * package-name form matched 1, for the same contract.
 */
export const QUERY_TEMPLATES = {
  mandate: `#${PACKAGE_NAME}:Writ.Mandate:Mandate`,
  quote: `#${PACKAGE_NAME}:Writ.Mandate:Quote`,
  deal: `#${PACKAGE_NAME}:Writ.Mandate:Deal`,
} as const;

class LedgerError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`ledger ${status}: ${body}`);
  }
}

async function call<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const bearer = await token();
  const res = await fetch(`${BASE}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  const text = await res.text();
  if (!res.ok) throw new LedgerError(res.status, text);

  // Some v2 endpoints stream newline-delimited JSON rather than one document.
  try {
    return JSON.parse(text) as T;
  } catch {
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l)) as T;
  }
}

/** Allocate a party, or return the existing one with that hint. */
export async function ensureParty(hint: string): Promise<string> {
  const existing = await listParties();
  const found = existing.find((p) => p.startsWith(`${hint}::`));
  if (found) return found;

  const r = await call<{ partyDetails: { party: string } }>('/v2/parties', {
    partyIdHint: hint,
    identityProviderId: '',
  });
  return r.partyDetails.party;
}

export async function listParties(): Promise<string[]> {
  const r = await call<{ partyDetails: { party: string }[] }>('/v2/parties');
  return r.partyDetails.map((p) => p.party);
}

async function ledgerEnd(): Promise<number> {
  const r = await call<{ offset: number }>('/v2/state/ledger-end');
  return r.offset;
}

interface ActiveContractRow {
  contractEntry?: {
    JsActiveContract?: {
      createdEvent: {
        contractId: string;
        templateId: string;
        createArgument: Record<string, unknown>;
      };
    };
  };
}

/**
 * Read the active contract set for one template, through one party's eyes.
 *
 * The `asParty` argument is doing real work: Canton returns only contracts
 * that party is a stakeholder on. A supplier querying for mandates gets an
 * empty list — not a permission error, because the contract was never
 * distributed to their participant node in the first place.
 */
export async function queryContracts<T>(
  templateId: string,
  asParty: string,
): Promise<Contract<T>[]> {
  const offset = await ledgerEnd();
  const rows = await call<ActiveContractRow[]>('/v2/state/active-contracts', {
    filter: {
      filtersByParty: {
        [asParty]: {
          cumulative: [
            {
              identifierFilter: {
                TemplateFilter: { value: { templateId, includeCreatedEventBlob: false } },
              },
            },
          ],
        },
      },
    },
    verbose: false,
    activeAtOffset: offset,
  });

  return rows
    .map((r) => r.contractEntry?.JsActiveContract?.createdEvent)
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .map((e) => ({ contractId: e.contractId, payload: e.createArgument as T }));
}

let commandCounter = 0;
function commandId(prefix: string): string {
  commandCounter += 1;
  return `${prefix}-${Date.now()}-${commandCounter}`;
}

async function submit(commands: unknown[], actAs: string[]): Promise<{ updateId: string }> {
  return call<{ updateId: string }>('/v2/commands/submit-and-wait', {
    commands,
    commandId: commandId('writ'),
    actAs,
    readAs: [],
    userId: USER_ID,
  });
}

export async function createMandate(m: Mandate): Promise<{ updateId: string }> {
  return submit(
    [{ CreateCommand: { templateId: TEMPLATES.mandate, createArguments: m } }],
    [m.principal],
  );
}

export async function createQuote(q: Quote): Promise<{ updateId: string }> {
  return submit(
    [{ CreateCommand: { templateId: TEMPLATES.quote, createArguments: q } }],
    [q.counterparty],
  );
}

/**
 * Spend against a mandate.
 *
 * A rejection here is the product working, not failing. The ledger's error
 * message carries the specific assertion that tripped, which the UI surfaces
 * verbatim — that text is the proof that enforcement happened off-agent.
 */
export async function commit(
  mandateCid: string,
  quoteCid: string,
  agent: string,
): Promise<CommitResult> {
  try {
    const r = await submit(
      [
        {
          ExerciseCommand: {
            templateId: TEMPLATES.mandate,
            contractId: mandateCid,
            choice: 'Commit',
            choiceArgument: { quoteCid },
          },
        },
      ],
      [agent],
    );
    return { ok: true, dealCid: r.updateId, mandateCid };
  } catch (e) {
    if (e instanceof LedgerError) {
      return { ok: false, rejectedBy: 'ledger', reason: extractReason(e.body) };
    }
    throw e;
  }
}

/**
 * Pull the human-readable assertion out of a Canton error payload.
 *
 * Canton wraps failures in several layers of protocol detail; the sentence
 * a judge needs to read is the `assertMsg` text from the Daml choice.
 */
export function extractReason(body: string): string {
  // Measured shape from a Canton 3.4.11 participant:
  //   "cause": "Interpretation error: Error: User failure:
  //     UNHANDLED_EXCEPTION/DA.Exception.AssertionFailed:AssertionFailed
  //     (error category 9): amount 12000.0 exceeds per-transaction cap 10000.0"
  // Everything before "(error category N):" is protocol noise; the sentence
  // after it is the assertMsg text a judge needs to read.
  const assertion = body.match(/error category \d+\):\s*([^"\\]+)/);
  if (assertion?.[1]) return assertion[1].trim();

  const cause = body.match(/"(?:cause|message)"\s*:\s*"([^"]+)"/);
  if (cause?.[1]) return cause[1].replace(/\\n/g, ' ').trim();

  return body.slice(0, 300);
}

export async function getMandates(asParty: string) {
  return queryContracts<Mandate>(QUERY_TEMPLATES.mandate, asParty);
}
export async function getQuotes(asParty: string) {
  return queryContracts<Quote>(QUERY_TEMPLATES.quote, asParty);
}
export async function getDeals(asParty: string) {
  return queryContracts<Deal>(QUERY_TEMPLATES.deal, asParty);
}
