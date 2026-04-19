#!/usr/bin/env bash
# =============================================================================
# install-fail2ban-pos.sh — ship audit.log-based fail2ban jails (Bosqich 19)
# -----------------------------------------------------------------------------
# Idempotent. Run on the Hetzner host as root (or sudo):
#   sudo bash /opt/pos/deploy/scripts/install-fail2ban-pos.sh
#
# Does:
#   1. apt install fail2ban (if missing)
#   2. Installs filter + jail snippets from deploy/security/fail2ban/
#   3. fail2ban-client reload
#   4. fail2ban-regex smoke test with synthetic JSONL lines
#
# Rollback:
#   sudo rm /etc/fail2ban/filter.d/pos-audit*.conf \
#            /etc/fail2ban/jail.d/pos-audit.local
#   sudo fail2ban-client reload
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FB_SRC="${REPO_ROOT}/deploy/security/fail2ban"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0"
  exit 1
fi

if ! command -v fail2ban-client >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban
fi

install -d -m 0755 /etc/fail2ban/filter.d /etc/fail2ban/jail.d

install -m 0644 "${FB_SRC}/filter.d/pos-audit.conf"       /etc/fail2ban/filter.d/pos-audit.conf
install -m 0644 "${FB_SRC}/filter.d/pos-audit-probe.conf" /etc/fail2ban/filter.d/pos-audit-probe.conf
install -m 0644 "${FB_SRC}/jail.d/pos-audit.local"        /etc/fail2ban/jail.d/pos-audit.local

# ---------------------------------------------------------------------------
# Synthetic lines — must match filter failregex (same shape as auditLog.cjs).
# ---------------------------------------------------------------------------
TMP_LOG="$(mktemp)"
trap 'rm -f "$TMP_LOG"' EXIT
cat > "$TMP_LOG" <<'JSONL'
{"t":"2030-01-01T00:00:00.000Z","type":"auth.login.failure","username":"x","ip":"198.51.100.77","reason":"bad","ua":"curl"}
{"t":"2030-01-01T00:00:01.000Z","type":"rate_limit.blocked","key":"198.51.100.88|u","kind":"login","ip":"198.51.100.88","channel":"pos:auth:login"}
JSONL

set +e
FBR_OUT=$(fail2ban-regex "$TMP_LOG" /etc/fail2ban/filter.d/pos-audit.conf 2>&1)
FBR_RC=$?
set -e
echo "$FBR_OUT"
if [[ "$FBR_RC" -ne 0 ]]; then
  echo "❌ fail2ban-regex exited $FBR_RC"
  exit 1
fi
if ! echo "$FBR_OUT" | grep -qE '198\.51\.100\.77'; then
  echo "❌ synthetic login.failure IP not matched"
  exit 1
fi
if ! echo "$FBR_OUT" | grep -qE '198\.51\.100\.88'; then
  echo "❌ synthetic rate_limit IP not matched"
  exit 1
fi
echo "✓ fail2ban-regex: synthetic audit lines matched pos-audit filter"

systemctl enable --now fail2ban
fail2ban-client reload

echo
echo "============================================================"
echo "✓ fail2ban POS jails installed"
fail2ban-client status pos-audit || true
echo "============================================================"
echo "Tune maxretry/findtime in /etc/fail2ban/jail.d/pos-audit.local"
echo "Logs: journalctl -u fail2ban -f"
echo "============================================================"
