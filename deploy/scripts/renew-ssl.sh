#!/usr/bin/env bash
# =============================================================================
# POS Server — Let's Encrypt sertifikat qayta yangilash (dry-run yoki real)
# =============================================================================
# certbot.timer avtomatik ishlaydi, bu skript faqat qo'lda tekshirish uchun.
#
# Ishlatish:
#   sudo deploy/scripts/renew-ssl.sh            # real yangilash
#   sudo deploy/scripts/renew-ssl.sh --dry-run  # test (sertifikatni o'zgartirmasdan)
# =============================================================================

set -Eeuo pipefail

MODE="real"
if [[ "${1:-}" == "--dry-run" ]]; then
  MODE="dry-run"
fi

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "[err] Root bo'lib ishga tushiring: sudo $0 ${1:-}" >&2
  exit 1
fi

if ! command -v certbot >/dev/null 2>&1; then
  echo "[err] certbot o'rnatilmagan. setup-nginx.sh avval ishlating." >&2
  exit 1
fi

echo "[ssl] Sertifikat ro'yxati:"
certbot certificates

echo
echo "[ssl] Yangilashni tekshirish (mode=$MODE)…"
if [[ "$MODE" == "dry-run" ]]; then
  certbot renew --dry-run
  echo "[ok] Dry-run muvaffaqiyatli — real yangilash ishlaydi"
else
  certbot renew --non-interactive --deploy-hook 'systemctl reload nginx'
  echo "[ok] Sertifikatlar yangilandi (kerak bo'lsa)"
fi

echo
echo "[ssl] certbot.timer holati:"
systemctl status certbot.timer --no-pager | head -n 8 || true
