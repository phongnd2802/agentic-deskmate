#!/usr/bin/env bash
# Regenerates evidence/. Needs ../../run.sh running. Takes about 8 minutes.
cd "$(dirname "$0")"
: > ../../evidence/backend-log.jsonl
for s in q123 q4 q4b q4c q5 q5b q67 q89 q10; do
  echo "=== $s"
  node "$s.mjs" > /dev/null || echo "FAILED $s"
done
echo finished
