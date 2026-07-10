#!/usr/bin/env bash
# Idempotent env setup for the Alloy sandbox.
#
# taskbash is a Next.js 15 app whose product routes depend on a live Supabase
# project plus a long list of third-party API keys (Anthropic, Nango, Inngest,
# Tavily, Composio, Nebius, Twilio, ...). None of those services are available
# in the sandbox, so this script only fills the *minimum* set of env vars
# required for the Next.js server to boot and serve the public, backend-free
# marketing page at /home.
#
# Rules:
#   - Read real values from the process environment first.
#   - Only fill local-dev-safe placeholders / generated secrets for values that
#     are blank or still set to a documented placeholder.
#   - Never overwrite a user-provided value.
#   - Never print secret values.
#
# The generated .env.local is git-ignored (see .gitignore) and is NOT committed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"

touch "$ENV_FILE"

# gen_secret: shell-safe hex secret.
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Read current value of KEY from ENV_FILE (empty if absent).
current_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | head -n1
}

# is_placeholder: treat blank / known example placeholders as "needs filling".
is_placeholder() {
  local val="$1"
  case "$val" in
    "" ) return 0 ;;
    "eyJ..." ) return 0 ;;
    "https://YOUR_PROJECT.supabase.co" ) return 0 ;;
    *"YOUR_PROJECT"* ) return 0 ;;
    __ALLOY_PLACEHOLDER__* ) return 0 ;;
    * ) return 1 ;;
  esac
}

# set_var KEY DEFAULT
#   Precedence: existing non-placeholder in .env.local  >  process env  >  DEFAULT.
set_var() {
  local key="$1"
  local default_val="$2"

  local existing
  existing="$(current_value "$key")"
  if ! is_placeholder "$existing"; then
    # A real value is already present in the file — leave it alone.
    return 0
  fi

  # Prefer a real value from the process environment.
  local proc_val="${!key-}"
  local final_val
  if [ -n "${proc_val}" ] && ! is_placeholder "${proc_val}"; then
    final_val="$proc_val"
  else
    final_val="$default_val"
  fi

  # Rewrite the key in place, or append if missing.
  if grep -q "^${key}=" "$ENV_FILE"; then
    local tmp
    tmp="$(mktemp)"
    grep -v "^${key}=" "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  fi
  printf '%s=%s\n' "$key" "$final_val" >> "$ENV_FILE"
}

# --- Supabase (format-valid placeholders so clients construct without throwing) ---
# The service-role client in lib/supabase.ts throws at import unless these exist.
# The middleware / SSR clients need a URL that parses; the network call fails and
# is caught, which correctly renders public routes as unauthenticated.
set_var NEXT_PUBLIC_SUPABASE_URL       "https://localhost-placeholder.supabase.co"
set_var NEXT_PUBLIC_SUPABASE_ANON_KEY  "__ALLOY_PLACEHOLDER__anon"
set_var SUPABASE_URL                   "https://localhost-placeholder.supabase.co"
set_var SUPABASE_SERVICE_ROLE_KEY      "__ALLOY_PLACEHOLDER__service_role"

# --- App basics ---
set_var NEXT_PUBLIC_APP_URL "http://localhost:3000"
set_var APP_USER_ID         "00000000-0000-0000-0000-000000000001"

# --- Alloy runtime flag (so app code can branch on sandbox if needed) ---
set_var IS_ALLOY "${IS_ALLOY:-true}"

# --- Optional integrations: leave blank so their SDKs no-op / stay disabled ---
# (Anthropic, Nango, Inngest, Tavily, Composio, Nebius, Twilio, Sentry.)
# We intentionally do NOT invent fake keys for these — the public /home route
# does not touch them, and fake keys could trigger real failing network calls.

echo "populate-env: .env.local is ready (secrets not shown)."
