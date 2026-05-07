/**
 * Joriy POS foydalanuvchisi (asosan audit / serverda amal bajaruvchi).
 * Desktop: pos:auth:login yoki pos:auth:setSessionUser orqali o‘rnatiladi.
 */
let currentUserId = null;

function setCurrentUserId(id) {
  if (id == null || id === '') {
    currentUserId = null;
    return;
  }
  const s = String(id).trim();
  currentUserId = s || null;
}

function getCurrentUserId() {
  return currentUserId;
}

module.exports = { setCurrentUserId, getCurrentUserId };
