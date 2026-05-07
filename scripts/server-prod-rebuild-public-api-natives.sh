#!/usr/bin/env bash
# Public API: Ubuntu'dagi `nodejs` 18.x va better-sqlite3 o'rtasida ABI ziddiyati bo'lishi mumkin.
# Yechim: serverda Node.js 20 (NodeSource) + better-sqlite3'ni shu node bilan qayta yig'ish.
#
# Ishlatish (serverda):
#   bash /opt/pos/scripts/server-prod-rebuild-public-api-natives.sh
set -eu
set -o pipefail
N_MAJ="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
if [ "${N_MAJ:-0}" -lt 20 ]; then
  echo "Kutilayotgan: Node.js 20+ (hozir: $(node -v 2>/dev/null || echo yoq)). NodeSource: https://github.com/nodesource/distributions" >&2
  exit 1
fi
cd /opt/pos/public-api
rm -rf node_modules/better-sqlite3
npm install better-sqlite3@11.10.0 --no-audit --no-fund --build-from-source
node <<'NODETEST'
const Database = require('better-sqlite3');
new Database(':memory:').close();
const f = new Database('/var/lib/pos/pos.db', { readonly: true });
f.close();
console.log('OK: :memory: va /var/lib/pos/pos.db');
NODETEST
systemctl restart public-api.service
systemctl restart telegram-bot.service
sleep 2
echo "---"
curl -fsS "http://127.0.0.1:3334/v1/bot/metrics" | head -c 500
echo
