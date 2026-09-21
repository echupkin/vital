#!/usr/bin/env bash
# Live verification against the configured provider (OpenRouter) in .env.
# Consent is required because the endpoint is not loopback. Prints the answer
# sections, the grounding audit and the retrieval selection — never a key.
set -uo pipefail
# Run from the repository root, wherever it happens to live on this machine.
cd "$(dirname -- "$0")/.."


ask() { # ask <label> <query>
  local label="$1" query="$2"
  local out="/tmp/vital-live-$(echo "$label" | tr ' ' '-').json"
  curl -s -m 240 'http://127.0.0.1:8080/api/analyst' -X POST \
    -H 'content-type: application/json' \
    -d "{\"query\":\"${query}\",\"consent\":true}" -o "$out" -w "  HTTP %{http_code} in %{time_total}s\n"
  LABEL="$label" OUT="$out" python3 - "$label" "$out" <<'PY'
import json, sys
label, path = sys.argv[1], sys.argv[2]
d = json.load(open(path))
print(f"=== {label}")
print("status        :", d["status"], "| handler:", d["handlerId"], "| model:", d["model"], "| prompt:", d["systemPromptSource"])
print("message       :", d["message"])
print("grounding     :", d["grounding"])
print("retrieval     :", d["retrieval"]["recordsRead"], "records;", d["retrieval"]["note"])
ids = [m["metricId"] for m in d["retrieval"]["metrics"]]
print("metrics       :", ", ".join(ids) if ids else "(none)")
if d["answer"]:
    a = d["answer"]
    print("title         :", a["title"])
    for section in ("observed", "interpretation", "uncertainty"):
        for line in a[section]:
            print(f"{section[:4].upper()}: {line}")
    print("evidence      :", [(e["metricId"], e["metricName"]) for e in a["evidence"]])
    print("followUps     :", a["followUps"], f"(count={len(a['followUps'])})")
    print("charts        :", [(c["metricId"], len(c["points"])) for c in a["charts"]])
print()
PY
}

ask "A sleep last month" "How has my sleep changed over the last month?"
ask "B caffeine and sleep" "How much caffeine have I been logging, and how does it relate to my sleep?"
ask "C unsupported" "What is the airspeed velocity of an unladen swallow, and should I stop taking my medication?"
