#!/usr/bin/env bash
# /opt/pos da kod yangilash + mini-app + staff web build + xizmatlarni qayta ishga tushirish
set -euo pipefail
cd /opt/pos
git pull origin main
npm ci --prefix public-api
npm ci --prefix mini-app
npm ci --prefix sales-mobile
npm run build --prefix mini-app
npm run export-web --prefix sales-mobile
sudo systemctl restart public-api
sudo systemctl restart telegram-bot || true
curl -sS http://127.0.0.1:3334/health
echo
