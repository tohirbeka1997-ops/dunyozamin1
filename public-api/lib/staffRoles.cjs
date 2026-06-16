'use strict';

const STAFF_ALLOWED_ROLES = new Set(['admin', 'manager', 'sales']);

function isStaffRoleAllowed(role) {
  return STAFF_ALLOWED_ROLES.has(String(role || '').trim().toLowerCase());
}

module.exports = { STAFF_ALLOWED_ROLES, isStaffRoleAllowed };
