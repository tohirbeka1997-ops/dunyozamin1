#!/usr/bin/env bash
# =============================================================================
# POS — install the hourly off-site backup timer (systemd)
# =============================================================================
# Prerequisites:
#   1. /opt/pos/.env exists and has POS_BACKUP_REMOTE / POS_BACKUP_REMOTE_PATH.
#   2. /opt/pos/deploy/backup/rclone.conf exists (see rclone.conf.example).
#   3. `rclone` is installed on the host:
#        apt install -y rclone         (Debian/Ubuntu)
#      OR run via the Docker sidecar (docker-compose.backup.yaml) instead of
#      systemd.
#
# Usage (as root):
#   bash /opt/pos/deploy/scripts/install-backup-timer.sh
# =============================================================================
set -euo pipefail

if [[ $(id -u) -ne 0 ]]; then
  echo "❌ Run as root (or via sudo)."
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "⚠ rclone not found. Install with: apt install -y rclone"
  echo "  (or skip systemd and use the docker-compose.backup.yaml sidecar)"
  exit 1
fi

RCLONE_CONF=/opt/pos/deploy/backup/rclone.conf
if [[ ! -f "$RCLONE_CONF" ]]; then
  echo "❌ $RCLONE_CONF not found. Copy from rclone.conf.example and fill in."
  exit 1
fi
chmod 0600 "$RCLONE_CONF"
chown deploy:deploy "$RCLONE_CONF"

install -m 0755 -o deploy -g deploy /opt/pos/deploy/scripts/backup-offsite.sh \
  /opt/pos/deploy/scripts/backup-offsite.sh

# Install the unit files into /etc/systemd/system (not /lib, so package updates
# don't fight us).
install -m 0644 /opt/pos/deploy/backup/pos-backup-offsite.service \
  /etc/systemd/system/pos-backup-offsite.service
install -m 0644 /opt/pos/deploy/backup/pos-backup-offsite.timer \
  /etc/systemd/system/pos-backup-offsite.timer

systemctl daemon-reload
systemctl enable --now pos-backup-offsite.timer

echo
echo "============================================================"
echo "✓ off-site backup timer installed"
echo
echo "Status:"
systemctl status pos-backup-offsite.timer --no-pager || true
echo
echo "Helpful commands:"
echo "  systemctl list-timers pos-backup-offsite.timer"
echo "  systemctl start pos-backup-offsite.service      # run once, now"
echo "  journalctl -u pos-backup-offsite.service -n 50"
echo "  journalctl -t pos-offsite --since '1 hour ago'"
echo "============================================================"
