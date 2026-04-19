#!/usr/bin/env bash
# =============================================================================
# POS — server-side bootstrap (run ONCE on a fresh Hetzner host)
# =============================================================================
# Prepares the directory layout, Docker, GHCR login, and an unprivileged
# deploy user so CI/CD can take over afterwards.
#
# Usage (as root):
#   curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/deploy/scripts/server-bootstrap.sh \
#     | DEPLOY_USER=deploy POS_DOMAIN=pos.example.com bash
#
# Inputs (env vars):
#   DEPLOY_USER       — unix user CI will SSH in as (default: deploy)
#   POS_DOMAIN        — fqdn for the POS (optional, only for echoing hints)
#   GHCR_USER         — GitHub user/org that owns the image (for docker login)
#   GHCR_TOKEN        — GitHub PAT with read:packages scope
#
# Creates:
#   /opt/pos/              (docker-compose + .env live here)
#   /opt/pos/_incoming/    (CI stages compose files here)
#   /var/www/pos/current   (symlink to the newest frontend release)
#   /var/www/pos/releases/ (timestamped frontend builds)
#   docker group + deploy user
# =============================================================================
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
POS_DOMAIN="${POS_DOMAIN:-}"

if [[ $(id -u) -ne 0 ]]; then
  echo "❌ Run as root (or via sudo)."
  exit 1
fi

echo "▶ Updating apt and installing base packages…"
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg rsync ufw sudo

# ---------------------------------------------------------------------------
# 1) Docker Engine + Compose plugin (official repo)
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "▶ Installing Docker Engine…"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  OS_ID=$(. /etc/os-release && echo "$ID")
  CODENAME=$(. /etc/os-release && echo "${VERSION_CODENAME}")
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${OS_ID} ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  echo "✓ docker already installed ($(docker --version))"
fi

# ---------------------------------------------------------------------------
# 2) Deploy user
# ---------------------------------------------------------------------------
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "▶ Creating user '$DEPLOY_USER'…"
  useradd -m -s /bin/bash "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

# Passwordless reload of nginx (frontend deploy swaps symlinks).
cat >/etc/sudoers.d/pos-deploy <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: /bin/systemctl reload nginx
EOF
chmod 0440 /etc/sudoers.d/pos-deploy

# ---------------------------------------------------------------------------
# 3) Directory layout
# ---------------------------------------------------------------------------
echo "▶ Creating /opt/pos and /var/www/pos…"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0750 /opt/pos /opt/pos/_incoming
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 /var/www/pos /var/www/pos/releases

# Fetch the rollback helper next to the compose files so ops can use it
# without pulling the whole repo onto the server.
SCRIPT_URL="https://raw.githubusercontent.com/${GITHUB_REPO:-OWNER/REPO}/main/deploy/scripts/pos-pull-restart.sh"
if curl -fsSL "$SCRIPT_URL" -o /opt/pos/pos-pull-restart.sh 2>/dev/null; then
  chmod +x /opt/pos/pos-pull-restart.sh
  chown "$DEPLOY_USER:$DEPLOY_USER" /opt/pos/pos-pull-restart.sh
  echo "✓ /opt/pos/pos-pull-restart.sh installed"
else
  echo "⚠ Could not fetch pos-pull-restart.sh — copy it manually from the repo."
fi

# Placeholder so nginx doesn't 404 before the first frontend publish.
if [ ! -e /var/www/pos/current ]; then
  install -d /var/www/pos/releases/init
  echo "<!doctype html><title>POS</title><h1>POS server is up</h1><p>Frontend not deployed yet.</p>" \
    > /var/www/pos/releases/init/index.html
  ln -sfn releases/init /var/www/pos/current
  chown -R "$DEPLOY_USER:$DEPLOY_USER" /var/www/pos
fi

# ---------------------------------------------------------------------------
# 4) GHCR login for the deploy user
# ---------------------------------------------------------------------------
if [[ -n "${GHCR_USER:-}" && -n "${GHCR_TOKEN:-}" ]]; then
  echo "▶ Logging docker into ghcr.io as '$GHCR_USER'…"
  sudo -u "$DEPLOY_USER" bash -c \
    "echo '$GHCR_TOKEN' | docker login ghcr.io -u '$GHCR_USER' --password-stdin"
else
  echo "⚠ GHCR_USER/GHCR_TOKEN not provided — skip docker login for now."
  echo "  CI will run 'docker login' per deploy using the repo secrets."
fi

# ---------------------------------------------------------------------------
# 5) Firewall (UFW): 22 / 80 / 443
# ---------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1; then
  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null
  ufw allow 22/tcp   || true
  ufw allow 80/tcp   || true
  ufw allow 443/tcp  || true
  ufw --force enable || true
fi

echo
echo "============================================================"
echo "✓ server-bootstrap finished"
echo "  deploy user: $DEPLOY_USER"
echo "  opt dir    : /opt/pos"
echo "  web root   : /var/www/pos/current"
[[ -n "$POS_DOMAIN" ]] && echo "  domain     : $POS_DOMAIN"
echo
echo "Next steps:"
echo "  1) Add the CI public key to /home/$DEPLOY_USER/.ssh/authorized_keys"
echo "  2) Copy /opt/pos/.env (POS_HOST_SECRET etc.) from .env.server.example"
echo "  3) Run deploy/scripts/setup-nginx.sh for vhost + SSL"
echo "  4) Push to main — GitHub Actions will build & deploy"
echo "============================================================"
