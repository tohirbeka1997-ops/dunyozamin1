#!/usr/bin/env bash
# /opt/pos da kod yangilash + mini-app build + xizmatlarni qayta ishga tushirish
set -euo pipefail
cd /opt/pos
git pull origin main
npm ci --prefix public-api
npm ci --prefix mini-app
npm run build --prefix mini-app
sudo systemctl restart public-api
sudo systemctl restart telegram-bot || true
curl -sS http://127.0.0.1:3334/health
echo
