#!/usr/bin/env bash
# ZAP baseline (passive) scan of staging (T-09-03). Usage:
#   security/zap/run-baseline.sh https://www.<staging marketing host> [https://<staging workspace host>]
# Authenticated scan: pass a workspace session cookie in ZAP_SESSION_COOKIE (test user, staging).
set -euo pipefail
case "${1:-}" in *prod*|"") echo "usage: $0 <staging url> [workspace url] (never production)"; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"
for target in "$@"; do
  extra=()
  if [[ -n "${ZAP_SESSION_COOKIE:-}" && "$target" != "$1" ]]; then
    extra=(-z "-config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Cookie -config replacer.full_list(0).replacement=${ZAP_SESSION_COOKIE}")
  fi
  docker run --rm -v "$here:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
    -t "$target" -c zap-baseline.conf -r "zap-$(echo "$target" | tr -c 'a-z0-9' '_').html" \
    "${extra[@]}"
done
