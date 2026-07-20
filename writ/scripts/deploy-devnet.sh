#!/usr/bin/env bash
#
# Deploy Writ to a Canton Devnet validator.
#
# Everything this needs is a credential set the validator operator issues.
# Once you have it, this is the whole deployment: fetch a token, upload the
# DAR, read back the package id, and print the environment the web app needs.
#
# Usage:
#   export LEDGER_BASE_URL=https://<validator-json-api>
#   export OIDC_ISSUER=https://<issuer>
#   export OIDC_CLIENT_ID=...
#   export OIDC_CLIENT_SECRET=...
#   export OIDC_AUDIENCE=https://canton.network.global   # often this default
#   export OIDC_SCOPE=daml_ledger_api
#   ./scripts/deploy-devnet.sh
#
set -euo pipefail

# Resolve paths relative to this script so it works from any cwd.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAR="$ROOT/daml/mandate-model/.daml/dist/mandate-model-0.1.0.dar"

need() {
  if [ -z "${!1:-}" ]; then
    echo "error: $1 is not set. See the header of this script." >&2
    exit 1
  fi
}

need LEDGER_BASE_URL
need OIDC_ISSUER
need OIDC_CLIENT_ID
need OIDC_CLIENT_SECRET

SCOPE="${OIDC_SCOPE:-daml_ledger_api}"
AUDIENCE="${OIDC_AUDIENCE:-https://canton.network.global}"

if [ ! -f "$DAR" ]; then
  echo "==> DAR not found, building"
  (cd "$ROOT/daml/mandate-model" && daml build --no-legacy-assistant-warning)
fi
echo "==> DAR: $DAR ($(du -h "$DAR" | cut -f1))"

# ---- 1. token -------------------------------------------------------------
# Client-credentials grant. The token endpoint is usually the issuer plus
# /protocol/openid-connect/token (Keycloak) or /oauth/token (Auth0); try the
# discovery document first so we do not have to guess.
echo "==> Discovering token endpoint"
TOKEN_URL=$(curl -sf -m 20 "${OIDC_ISSUER%/}/.well-known/openid-configuration" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token_endpoint'])" 2>/dev/null || true)

if [ -z "$TOKEN_URL" ]; then
  TOKEN_URL="${OIDC_ISSUER%/}/protocol/openid-connect/token"
  echo "    discovery unavailable, falling back to: $TOKEN_URL"
else
  echo "    $TOKEN_URL"
fi

echo "==> Requesting access token"
TOKEN=$(curl -sf -m 30 -X POST "$TOKEN_URL" \
  -d grant_type=client_credentials \
  -d "client_id=$OIDC_CLIENT_ID" \
  -d "client_secret=$OIDC_CLIENT_SECRET" \
  -d "audience=$AUDIENCE" \
  -d "scope=$SCOPE" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

if [ -z "$TOKEN" ]; then
  echo "error: no access token returned" >&2
  exit 1
fi
echo "    got token (${#TOKEN} chars)"

# ---- 2. upload ------------------------------------------------------------
echo "==> Uploading DAR to ${LEDGER_BASE_URL}"
UPLOAD=$(curl -s -m 180 -X POST "${LEDGER_BASE_URL%/}/v2/packages" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary "@$DAR" -w '\n%{http_code}')

CODE=$(echo "$UPLOAD" | tail -1)
if [ "$CODE" != "200" ] && [ "$CODE" != "201" ]; then
  echo "error: upload failed (HTTP $CODE)" >&2
  echo "$UPLOAD" | head -c 800 >&2
  exit 1
fi
echo "    uploaded (HTTP $CODE)"

# ---- 3. confirm -----------------------------------------------------------
# The package id is baked into the DAR filename by the compiler, so read it
# from the archive rather than trusting the upload response shape.
PKG=$(unzip -l "$DAR" \
  | grep -oE "mandate-model-0\.1\.0-[a-f0-9]{64}" \
  | head -1 | sed 's/.*-//')

echo "==> Verifying package is vetted on the participant"
if curl -sf -m 30 "${LEDGER_BASE_URL%/}/v2/packages" -H "Authorization: Bearer $TOKEN" \
    | grep -q "$PKG"; then
  echo "    confirmed on-ledger: $PKG"
else
  echo "    warning: package not listed yet — vetting can lag the upload" >&2
fi

# ---- 4. hand off ----------------------------------------------------------
cat <<EOF

Deployed. Set these on the web app (Vercel project settings, or .env.local):

  LEDGER_BASE_URL=$LEDGER_BASE_URL
  LEDGER_TOKEN=<a fresh token from the same grant>
  MANDATE_PACKAGE_ID=$PKG

Then redeploy:

  cd web && npx vercel deploy --prod --yes

Note: LEDGER_TOKEN here is a bearer token with a short lifetime. For anything
beyond a demo, the app should perform the client-credentials grant itself and
refresh on expiry rather than holding a static token.
EOF
