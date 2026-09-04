#!/usr/bin/env bash
# docs/proof/check-deploy.sh — is the production deployment serving every bundle?
base="https://weave-webmcp.vercel.app"
for u in / /app/ /sandbox/ /preview-sandbox/ "/app/?weave=inspector"; do
  printf 'HTTP %s  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$base$u")" "$base$u"
done
echo
curl -s "$base/app/" | grep -o '<title>.*</title>'
echo
npx vercel ls weave-webmcp 2>&1 | grep -m1 -E 'Ready|Error' | awk '{printf "%s %s  %s  %s\n", $4, $5, $6, $3}'
