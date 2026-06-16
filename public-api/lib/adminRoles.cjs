'use strict';

// Admin panel uchun ruxsat etilgan rollar. Faqat admin va manager
// to'liq boshqaruv paneliga kira oladi (sales — kuryer/sotuvchi ilovasi uchun).
const ADMIN_ALLOWED_ROLES = new Set(['admin', 'manager']);

function isAdminRoleAllowed(role) {
  return ADMIN_ALLOWED_ROLES.has(String(role || '').trim().toLowerCase());
}

module.exports = { ADMIN_ALLOWED_ROLES, isAdminRoleAllowed };
