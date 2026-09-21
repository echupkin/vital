#!/usr/bin/env bash
# Client-bundle leak check (README: "No secrets in the client bundle").
#
# Greps every served .next/static chunk for the analyst credential, the HAE read
# token, the optional local-model credential, the configured provider host and
# the system-prompt marker strings — including the briefing's, which lives in
# its own server-only module and must not reach the browser either.
# It prints only counts — never a matched value — and never prints the .env file.
set -uo pipefail

cd "$(dirname "$0")/.."

env_get() { grep -m1 "^$1=" .env | cut -d= -f2-; }

KEY="$(env_get ANALYST_API_KEY)"
HAE_KEY="$(env_get HAE_API_KEY)"
LOCAL_KEY="$(env_get VITAL_LLM_API_KEY)"
PROMPT_FILE_MARKER="You are the analysis component of Vital"
PROMPT_QUOTE_MARKER="Quote these strings verbatim"
UNTRUSTED_MARKER="UNTRUSTED_CONTEXT_START"
BRIEFING_PROMPT_MARKER="You are the briefing writer for Vital"
BRIEFING_GUARD_MARKER="not in the recorded data"

status=0
check() {
  local label="$1" needle="$2"
  if [ -z "$needle" ]; then
    echo "SKIP  $label (nothing configured)"
    return
  fi
  local hits
  hits=$(grep -rlF -- "$needle" .next/static 2>/dev/null | wc -l)
  if [ "$hits" -eq 0 ]; then
    echo "PASS  $label — 0 files in .next/static"
  else
    echo "FAIL  $label — $hits file(s) contain it:"
    grep -rlF -- "$needle" .next/static 2>/dev/null | sed 's/^/        /'
    status=1
  fi
}

echo "Scanned tree: $(find .next/static -name '*.js' | wc -l) javascript files"
check "ANALYST_API_KEY value"      "$KEY"
check "HAE_API_KEY value"          "$HAE_KEY"
check "VITAL_LLM_API_KEY value"    "$LOCAL_KEY"
check "system prompt text"         "$PROMPT_FILE_MARKER"
check "prompt display rule"        "$PROMPT_QUOTE_MARKER"
check "untrusted-block delimiter"  "$UNTRUSTED_MARKER"
check "briefing system prompt"     "$BRIEFING_PROMPT_MARKER"
check "briefing guard wording"     "$BRIEFING_GUARD_MARKER"
check "OpenRouter host"            "openrouter.ai"

# The briefing's own instructions and context builder are server-only: the
# browser gets the rendered text and the attribution string, and nothing else.
check "briefing context builder"   "buildBriefingContext"
check "briefing engine"            "resolveBriefingEngine"

exit "$status"
