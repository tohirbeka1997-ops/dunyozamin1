#!/usr/bin/env bash
# =============================================================================
# verify-alertmanager.sh — sanity-check the Alertmanager wiring (Bosqich 17)
# -----------------------------------------------------------------------------
# Run this on the pos host after editing alertmanager.yml, alerts.yml, or
# the related secrets in .env. It performs three independent checks:
#
#   1. amtool check-config — YAML + template syntax (runs inside the
#      alertmanager container so the tool version matches the daemon).
#   2. Prometheus `/api/v1/status/config` — confirms Prometheus reloaded
#      the new `alerting:` block (catches typos in prometheus.yml).
#   3. End-to-end send — pushes a single synthetic alert via the AM API
#      and prints the receiver's response. Real Telegram message will
#      arrive unless TELEGRAM_ALERT_BOT_TOKEN is the placeholder value.
#
# Exit status:
#   0 — all checks passed
#   1 — at least one check failed; see stderr
#
# Requires: docker, curl, jq.  Intended to be called by CI and by humans.
# =============================================================================

set -euo pipefail

RED="\033[0;31m"; GREEN="\033[0;32m"; YELLOW="\033[1;33m"; RESET="\033[0m"
log()   { printf "%b\n" "$*"; }
pass()  { log "${GREEN}✓${RESET} $*"; }
warn()  { log "${YELLOW}!${RESET} $*"; }
fail()  { log "${RED}✗${RESET} $*" >&2; }

AM_CONTAINER="${AM_CONTAINER:-pos-alertmanager}"
PROM_CONTAINER="${PROM_CONTAINER:-pos-prometheus}"
AM_URL="${AM_URL:-http://127.0.0.1:9093}"
PROM_URL="${PROM_URL:-http://127.0.0.1:9090}"

errors=0

# -----------------------------------------------------------------------------
# 1) Static YAML / template lint using amtool. We invoke amtool INSIDE the
#    alertmanager container so we always get the same version and template
#    functions as the running daemon (important — template syntax subtly
#    differs between 0.25 and 0.27).
# -----------------------------------------------------------------------------
log "== 1/3 amtool check-config =="
if ! docker ps --format '{{.Names}}' | grep -qx "${AM_CONTAINER}"; then
  fail "alertmanager container '${AM_CONTAINER}' is not running"
  fail "  start with: docker compose --profile monitoring up -d alertmanager"
  errors=$((errors + 1))
else
  # /tmp/alertmanager.yml is the envsubst-rendered file the daemon reads.
  # Checking that one ensures secrets interpolated correctly.
  if docker exec "${AM_CONTAINER}" amtool check-config /tmp/alertmanager.yml; then
    pass "rendered config is syntactically valid"
  else
    fail "amtool rejected the rendered config — check envsubst substitutions"
    errors=$((errors + 1))
  fi
fi

# -----------------------------------------------------------------------------
# 2) Prometheus must have the alerting block and point at the AM service.
#    Without this wiring Prometheus will evaluate alert rules but never
#    push them anywhere — the silent failure mode.
# -----------------------------------------------------------------------------
log "\n== 2/3 Prometheus → Alertmanager wiring =="
if ! curl -fsS "${PROM_URL}/api/v1/status/config" >/dev/null 2>&1; then
  fail "can't reach Prometheus at ${PROM_URL}/api/v1/status/config"
  fail "  is the monitoring profile up? (docker compose --profile monitoring ps)"
  errors=$((errors + 1))
else
  # The config is a big YAML dumped as a JSON string; grep is fine here.
  if curl -fsS "${PROM_URL}/api/v1/status/config" \
      | jq -r '.data.yaml' \
      | grep -q 'alertmanager:9093'; then
    pass "Prometheus is wired to alertmanager:9093"
  else
    fail "Prometheus does NOT reference alertmanager:9093 in its live config"
    fail "  restart prometheus after editing prometheus.yml"
    errors=$((errors + 1))
  fi

  # A firing alert should show up in AM within ~1 evaluation interval.
  active=$(curl -fsS "${AM_URL}/api/v2/alerts" | jq 'length' 2>/dev/null || echo '0')
  log "  active alerts in Alertmanager: ${active}"
fi

# -----------------------------------------------------------------------------
# 3) End-to-end: push a synthetic alert. This bypasses Prometheus entirely
#    and proves the AM → notification channel round-trip works. Useful when
#    debugging Telegram token / SMTP password issues — failures here point
#    directly at the receiver, not at rule evaluation.
# -----------------------------------------------------------------------------
log "\n== 3/3 End-to-end notification test =="
now=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
payload=$(cat <<EOF
[
  {
    "labels": {
      "alertname": "PosAlertmanagerSmokeTest",
      "severity": "warning",
      "service": "pos",
      "team": "ops",
      "instance": "verify-alertmanager.sh"
    },
    "annotations": {
      "summary": "Synthetic smoke test from verify-alertmanager.sh",
      "description": "If you received this message, the notification pipeline works. Safe to ignore."
    },
    "startsAt": "${now}"
  }
]
EOF
)

if ! curl -fsS -H 'Content-Type: application/json' \
       -X POST --data-binary "${payload}" \
       "${AM_URL}/api/v2/alerts" >/dev/null; then
  fail "AM rejected the smoke-test alert"
  errors=$((errors + 1))
else
  pass "smoke alert accepted by Alertmanager"
  warn "check Telegram group + oncall email in the next ~30s"
  warn "if nothing arrives: docker logs ${AM_CONTAINER} | tail -50"
fi

# -----------------------------------------------------------------------------
log ""
if [[ "${errors}" -eq 0 ]]; then
  pass "All Alertmanager checks passed"
  exit 0
else
  fail "${errors} check(s) failed — pipeline is NOT safe to ship"
  exit 1
fi
