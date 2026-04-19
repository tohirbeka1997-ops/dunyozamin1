#!/usr/bin/env bash
# =============================================================================
# restore-drill-prom.sh — observable wrapper around restore-drill.sh (Bosqich 18)
# -----------------------------------------------------------------------------
# Runs the existing restore-drill.sh, captures duration + result, and:
#   1. Writes Prometheus textfile-collector metrics so Grafana/dashboards can
#      see "last successful drill" without needing to scrape the workflow.
#   2. On failure, pushes a synthetic alert directly to Alertmanager — the
#      same way the server would, so on-call gets a Telegram page even if
#      GitHub's own emails are ignored.
#   3. Always exits with the wrapped script's exit code (CI still sees red).
#
# Environment:
#   TEXTFILE_DIR      — where node-exporter reads *.prom files
#                       (default: /var/lib/pos/node-exporter-textfile)
#   ALERTMANAGER_URL  — AM API v2 URL. Empty → skip the push (dev).
#                       (default: http://127.0.0.1:9093)
#   DRILL_LOG_DIR     — where to archive drill stdout/stderr
#                       (default: /var/lib/pos/logs/restore-drill)
#
# Exit codes: inherited from restore-drill.sh (0 = pass).
# =============================================================================

set -uo pipefail
# NB: no `-e` here — we want to KEEP RUNNING after the drill fails so we
# can report the failure upstream. The rc is preserved explicitly.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRILL_SCRIPT="${HERE}/restore-drill.sh"

TEXTFILE_DIR="${TEXTFILE_DIR:-/var/lib/pos/node-exporter-textfile}"
TEXTFILE_OUT="${TEXTFILE_DIR}/pos_restore_drill.prom"
TEXTFILE_TMP="${TEXTFILE_OUT}.$$"

ALERTMANAGER_URL="${ALERTMANAGER_URL:-http://127.0.0.1:9093}"

DRILL_LOG_DIR="${DRILL_LOG_DIR:-/var/lib/pos/logs/restore-drill}"
mkdir -p "$DRILL_LOG_DIR" "$TEXTFILE_DIR" 2>/dev/null || true

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="${DRILL_LOG_DIR}/drill-${STAMP}.log"

# -----------------------------------------------------------------------------
# Run the drill, streaming stdout/stderr to the log AND the terminal so a
# CI step picks up the tail naturally.
# -----------------------------------------------------------------------------
START_EPOCH=$(date +%s)

# `tee` with a pipe fails `set -o pipefail` scenarios — we use exit status
# from a temp file instead.
RC_FILE="$(mktemp)"
( "$DRILL_SCRIPT" 2>&1; echo $? > "$RC_FILE" ) | tee "$LOG_FILE"
RC=$(cat "$RC_FILE")
rm -f "$RC_FILE"
END_EPOCH=$(date +%s)
DURATION=$((END_EPOCH - START_EPOCH))

# -----------------------------------------------------------------------------
# 1) Prometheus textfile — atomic write (rename) so node-exporter never reads
#    a half-written file. node-exporter polls every 15s by default.
# -----------------------------------------------------------------------------
# `pos_backup_restore_drill_last_run_timestamp_seconds` — always updated
# `pos_backup_restore_drill_last_success_timestamp_seconds` — only on rc=0
# `pos_backup_restore_drill_last_duration_seconds` — last run duration
# `pos_backup_restore_drill_last_status` — 0=fail, 1=pass (last run)
cat > "$TEXTFILE_TMP" <<EOF
# HELP pos_backup_restore_drill_last_run_timestamp_seconds UTC epoch of the last drill run (success OR fail).
# TYPE pos_backup_restore_drill_last_run_timestamp_seconds gauge
pos_backup_restore_drill_last_run_timestamp_seconds ${END_EPOCH}

# HELP pos_backup_restore_drill_last_duration_seconds Wall-clock duration of the last drill run.
# TYPE pos_backup_restore_drill_last_duration_seconds gauge
pos_backup_restore_drill_last_duration_seconds ${DURATION}

# HELP pos_backup_restore_drill_last_status 1 if the last run passed, 0 otherwise.
# TYPE pos_backup_restore_drill_last_status gauge
pos_backup_restore_drill_last_status $([[ "$RC" -eq 0 ]] && echo 1 || echo 0)
EOF

# Preserve the previous last_success timestamp if this run failed —
# otherwise the `PosRestoreDrillStale` alert can't tell between
# "never ran" and "ran recently but failed".
if [[ "$RC" -eq 0 ]]; then
  cat >> "$TEXTFILE_TMP" <<EOF

# HELP pos_backup_restore_drill_last_success_timestamp_seconds UTC epoch of the last PASSING drill.
# TYPE pos_backup_restore_drill_last_success_timestamp_seconds gauge
pos_backup_restore_drill_last_success_timestamp_seconds ${END_EPOCH}
EOF
else
  # Read existing value and re-emit so the gauge keeps ticking upward.
  prev=""
  if [[ -f "$TEXTFILE_OUT" ]]; then
    prev=$(awk '/^pos_backup_restore_drill_last_success_timestamp_seconds /{print $2; exit}' "$TEXTFILE_OUT" || true)
  fi
  if [[ -n "$prev" ]]; then
    cat >> "$TEXTFILE_TMP" <<EOF

# HELP pos_backup_restore_drill_last_success_timestamp_seconds UTC epoch of the last PASSING drill.
# TYPE pos_backup_restore_drill_last_success_timestamp_seconds gauge
pos_backup_restore_drill_last_success_timestamp_seconds ${prev}
EOF
  fi
fi

mv -f "$TEXTFILE_TMP" "$TEXTFILE_OUT"
echo "[restore-drill-prom] metrics written to $TEXTFILE_OUT"

# -----------------------------------------------------------------------------
# 2) Alertmanager push on failure — bypasses Prometheus (which might not have
#    evaluated the new textfile yet) so on-call hears about it within seconds.
# -----------------------------------------------------------------------------
if [[ "$RC" -ne 0 && -n "$ALERTMANAGER_URL" ]]; then
  now="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  # Failure is temporary from AM's perspective — we set an EndsAt 1h in the
  # future so if the next drill passes the alert is automatically resolved
  # (AM considers the absence of a new push → resolved).
  ends_at="$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || \
             date -u -v+1H +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || \
             echo "")"
  tail_msg=$(tail -c 400 "$LOG_FILE" | sed 's/"/\\"/g' | tr '\n' ' ')

  payload=$(cat <<EOF
[
  {
    "labels": {
      "alertname": "PosRestoreDrillFailed",
      "severity": "page",
      "service": "pos",
      "team": "ops",
      "instance": "$(hostname)"
    },
    "annotations": {
      "summary": "Weekly restore drill FAILED (rc=${RC})",
      "description": "Last 400 chars of drill log: ${tail_msg}",
      "runbook": "https://runbooks.example.com/pos/restore-drill-failed"
    },
    "startsAt": "${now}"$([[ -n "$ends_at" ]] && echo ",\"endsAt\":\"${ends_at}\"")
  }
]
EOF
  )

  echo "[restore-drill-prom] pushing failure alert to ${ALERTMANAGER_URL}"
  if ! curl -fsS --max-time 10 \
      -H 'Content-Type: application/json' \
      -X POST --data-binary "$payload" \
      "${ALERTMANAGER_URL}/api/v2/alerts" >/dev/null; then
    echo "[restore-drill-prom] WARN: failed to reach Alertmanager at ${ALERTMANAGER_URL}"
    # Not fatal — the textfile metrics still carry the signal for
    # `PosRestoreDrillStale` to trip within ~10 days.
  fi
fi

echo "[restore-drill-prom] drill finished in ${DURATION}s, rc=${RC}, log=${LOG_FILE}"
exit "$RC"
