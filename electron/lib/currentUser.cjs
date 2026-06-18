/**
 * Joriy POS foydalanuvchisi (asosan audit / serverda amal bajaruvchi).
 * Desktop: pos:auth:login yoki pos:auth:setSessionUser orqali o‘rnatiladi.
 *
 * `currentUserRole` — renderer sessiyasi main processga sinxronlanmaganda (masalan,
 * CLIENT rejimi yoki main process qayta ishga tushganda) IPC/RBAC tekshiruvlari
 * uchun zaxira manba.
 */
let currentUserId = null;
let currentUserRole = null;

function setCurrentUserId(id) {
  if (id == null || id === '') {
    currentUserId = null;
    currentUserRole = null;
    return;
  }
  const s = String(id).trim();
  currentUserId = s || null;
}

function setCurrentUserRole(role) {
  if (role == null || role === '') {
    currentUserRole = null;
    return;
  }
  currentUserRole = String(role).toLowerCase();
}

function setCurrentUserSession(id, role) {
  setCurrentUserId(id);
  if (id == null || id === '') return;
  if (role != null && role !== '') {
    setCurrentUserRole(role);
  }
}

function getCurrentUserRoleCache() {
  return currentUserRole;
}

function getCurrentUserId() {
  return currentUserId;
}

module.exports = {
  setCurrentUserId,
  setCurrentUserRole,
  setCurrentUserSession,
  getCurrentUserRoleCache,
  getCurrentUserId,
};
