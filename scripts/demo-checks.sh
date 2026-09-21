#!/usr/bin/env bash
# Demo-path verification, run INSIDE a container that has no network interface
# at all (--network none), so an outbound provider request is impossible: if the
# analyst still answers, it computed the answer locally.
set -uo pipefail

ask() {
  docker exec vital-demo wget -qO- \
    --header='Content-Type: application/json' \
    --post-data="$1" \
    http://127.0.0.1:3000/api/analyst
}

echo '--- interfaces inside the container ---'
docker exec vital-demo sh -c "cat /proc/net/dev; ip addr 2>/dev/null || true"

echo '--- GET config state ---'
docker exec vital-demo wget -qO- http://127.0.0.1:3000/api/analyst | python3 -c "
import json,sys
d=json.load(sys.stdin)
print({k:d[k] for k in ('configured','provider','providerDisplayName','model','destination','hasKey','consentRequired','systemPromptSource')})
print('prompts:', len(d['prompts']))
"

for q in 'How has my sleep changed over the last month?' 'How much caffeine have I been logging, and how does it relate to my sleep?' 'Should I stop taking my medication?'; do
  echo "--- demo: $q"
  ask "{\"query\":\"$q\"}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(' status      :', d['status'])
print(' provider    :', repr(d['provider']), '| label:', d['label'], '| configured:', d['providerConfigured'], '| systemPromptSource:', d['systemPromptSource'])
print(' consent     :', d['consent']['required'], d['consent']['destination'], '|', d['consent']['notice'][:80])
print(' handlerId   :', d['handlerId'], '| recordsRead:', d['retrieval']['recordsRead'], '| metrics:', [m['metricId'] for m in d['retrieval']['metrics']])
print(' grounding   :', d['grounding'])
if d['message']: print(' message     :', d['message'][:160])
a=d['answer']
if a:
    print(' title       :', a['title'])
    for l in a['observed'][:3]: print('   OBSE:', l)
    print('   followUps :', a['followUps'])
"
done

echo '--- determinism: the same question twice ---'
a=$(ask '{"query":"What changed this week?"}')
b=$(ask '{"query":"What changed this week?"}')
python3 - "$a" "$b" <<'PY'
import json, sys
a, b = json.loads(sys.argv[1]), json.loads(sys.argv[2])
print('answers identical:', a['answer'] == b['answer'], '| retrieval identical:', a['retrieval'] == b['retrieval'])
PY
