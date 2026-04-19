const { ipcMain } = require('electron');
const { wrapHandler, ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');

// Defensive check: ensure wrapHandler is imported correctly
if (typeof wrapHandler !== 'function') {
  throw new Error(
    `wrapHandler import is invalid: check electron/lib/errors.cjs export.\n` +
    `  Expected: function\n` +
    `  Actual: ${typeof wrapHandler}\n` +
    `  Ensure errors.cjs exports: module.exports = { wrapHandler, ... };`
  );
}

/**
 * Auth IPC Handlers
 * Channels: pos:auth:*
 * Handles authentication, password management, and password reset
 */
function registerAuthHandlers(services, db) {
  const { auth } = services;
  
  // Remove existing handlers to prevent conflicts with fallback handlers
  ipcMain.removeHandler('pos:auth:login');
  ipcMain.handle('pos:auth:login', async (_event, username, password) => {
    try {
      console.log('🔐 pos:auth:login called (real handler)', { username });
      
      // auth.login returns { success: true, user, message } or { success: false, error }
      const result = auth.login(username, password);
      
      if (result.success) {
        console.log('✅ Login successful - User:', result.user.username, 'Role:', result.user.role);
        console.log('✅ IPC Response:', JSON.stringify({ 
          success: result.success, 
          user: { id: result.user.id, username: result.user.username, role: result.user.role },
          message: result.message 
        }));

        // Record login session for "Login Activity" report.
        // Desktop app: we don't have a real client IP; keep it null.
        try {
          const now = new Date().toISOString().replace('T', ' ').replace('Z', '').substring(0, 19);
          const token = randomUUID();
          // Keep session valid for 30 days by default (used only for tracking/history right now).
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            .toISOString()
            .replace('T', ' ')
            .replace('Z', '')
            .substring(0, 19);

          db.prepare(
            `
            INSERT INTO sessions (id, user_id, token, ip_address, user_agent, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `
          ).run(randomUUID(), result.user.id, token, null, process?.versions?.electron ? `electron/${process.versions.electron}` : null, expiresAt, now);

          // Also update last_login on users table (if column exists).
          try {
            db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(result.user.id);
          } catch {
            // ignore
          }
        } catch (sessionErr) {
          console.warn('⚠️ Could not record login session:', sessionErr?.message || sessionErr);
        }
      } else {
        console.log('❌ Login failed:', result.error);
      }
      
      // Return the result object directly (it already has success/error format)
      // Format: { success: true, user: { id, username, full_name, email, role }, message: 'Welcome' }
      return result;
    } catch (error) {
      console.error('❌ pos:auth:login error:', error);
      // Return consistent error format
      return {
        success: false,
        error: error.message || 'Login failed'
      };
    }
  });

  ipcMain.removeHandler('pos:auth:getUser');
  ipcMain.handle('pos:auth:getUser', wrapHandler(async (_event, userId) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      throw createError(ERROR_CODES.NOT_FOUND, 'User not found');
    }

    // Get user roles
    const roles = db.prepare(`
      SELECT r.* 
      FROM user_roles ur
      INNER JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = ?
    `).all(user.id);

    const { password_hash, ...userWithoutPassword } = user;
    return {
      ...userWithoutPassword,
      roles,
    };
  }));

  ipcMain.removeHandler('pos:auth:checkPermission');
  ipcMain.handle('pos:auth:checkPermission', wrapHandler(async (_event, userId, permission) => {
    // Basic permission check - extend based on your permission system
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      throw createError(ERROR_CODES.NOT_FOUND, 'User not found');
    }

    // Get user roles
    const roles = db.prepare(`
      SELECT r.code
      FROM user_roles ur
      INNER JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = ?
    `).all(user.id).map(r => r.code);

    // Simple role-based check - extend with proper permission system
    const hasPermission = roles.includes('admin') || roles.includes(permission);

    return { hasPermission, roles };
  }));

  // Desktop/Electron has no real "session token" — the local window is the
  // authority. We still expose logout/me so the renderer can use the same
  // code path as the web/SaaS build. Logout is a no-op; me returns the last
  // logged-in user (best-effort) or null.
  ipcMain.removeHandler('pos:auth:logout');
  ipcMain.handle('pos:auth:logout', wrapHandler(async () => {
    return { success: true };
  }));

  ipcMain.removeHandler('pos:auth:me');
  ipcMain.handle('pos:auth:me', wrapHandler(async () => {
    // Best-effort: return the most-recently-logged-in active user.
    try {
      const row = db
        .prepare(
          `SELECT id, username, role, email, full_name, is_active
             FROM users
            WHERE is_active = 1
            ORDER BY datetime(COALESCE(last_login, created_at)) DESC
            LIMIT 1`,
        )
        .get();
      return row || null;
    } catch {
      return null;
    }
  }));

  // Password reset: Request reset code
  ipcMain.removeHandler('pos:auth:requestPasswordReset');
  ipcMain.handle('pos:auth:requestPasswordReset', wrapHandler(async (_event, identifier) => {
    return auth.requestPasswordReset(identifier);
  }));

  // Password reset: Confirm reset with code and new password
  ipcMain.removeHandler('pos:auth:confirmPasswordReset');
  ipcMain.handle('pos:auth:confirmPasswordReset', wrapHandler(async (_event, payload) => {
    return auth.confirmPasswordReset(payload);
  }));
}

module.exports = { registerAuthHandlers };


