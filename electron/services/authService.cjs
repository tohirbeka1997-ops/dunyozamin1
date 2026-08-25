const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');
const crypto = require('crypto');
const { hashPassword, verifyPassword, needsUpgrade } = require('../lib/password.cjs');

/**
 * Auth Service
 * Handles authentication, password management, and password reset
 */
class AuthService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Login user
   * Authenticates user by username/email and password
   * @param {string} username - Username to login (can be username or email)
   * @param {string} password - Password to verify
   * @returns {Object} { success: true, user: { id, username, full_name, email, role }, message: 'Welcome' }
   *                   or { success: false, error: 'Invalid credentials' }
   */
  login(username, password) {
    if (!username || !username.trim()) {
      return { success: false, error: 'Username is required' };
    }

    if (!password || !password.trim()) {
      return { success: false, error: 'Password is required' };
    }

    let trimmedUsername = username.trim().toLowerCase();
    const trimmedPassword = password.trim();

    // Common bootstrap aliases for the seeded admin account.
    const ADMIN_LOGIN_ALIASES = new Set(['admin', 'administrator']);
    const isAdminAlias = ADMIN_LOGIN_ALIASES.has(trimmedUsername);
    if (isAdminAlias) {
      trimmedUsername = 'admin@pos.com';
    }

    const stmt1 = this.db.prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?');
    let user = stmt1.get(trimmedUsername, trimmedUsername);

    // Backward-compatible admin lookup:
    // older/migrated installations may still keep the admin user as
    // `username='admin'` or `email='admin@postizimi.local'`.
    if (!user && isAdminAlias) {
      const legacyAdminCandidates = ['admin', 'admin@postizimi.local'];
      for (const candidate of legacyAdminCandidates) {
        user = stmt1.get(candidate, candidate);
        if (user) break;
      }
    }

    if (!user) {
      return { success: false, error: 'Invalid credentials' };
    }

    if (!user.is_active) {
      return { success: false, error: 'User account is inactive' };
    }

    // Refuse login when no password has ever been set. We deliberately do NOT
    // auto-assign a default password ('12345' or any other) — that practice
    // creates a well-known credential for any account whose password_hash got
    // wiped during migrations or seeding. The admin must use the password
    // reset flow instead.
    if (!user.password_hash) {
      return {
        success: false,
        error: 'Account is not configured. Please reset your password.',
      };
    }

    // Verify against scrypt or legacy SHA-256 hashes (timing-safe internally).
    const passwordOk = verifyPassword(trimmedPassword, user.password_hash);
    if (!passwordOk) {
      return { success: false, error: 'Invalid credentials' };
    }

    const passwordExpiredFlag =
      user.password_expired === 1 ||
      user.password_expired === true ||
      String(user.password_expired || '') === '1';
    if (passwordExpiredFlag) {
      return {
        success: false,
        error: 'Password reset required for security. Please use the password reset flow.',
        password_expired: true,
      };
    }

    // Transparently upgrade legacy SHA-256 hashes after a successful verify.
    if (needsUpgrade(user.password_hash)) {
      const upgraded = hashPassword(trimmedPassword);
      try {
        const userCols = this.db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
        const hasPasswordExpired = userCols.includes('password_expired');
        const updateSql = hasPasswordExpired
          ? `UPDATE users SET password_hash = ?, password_expired = 0, updated_at = datetime('now') WHERE id = ?`
          : `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`;
        this.db.prepare(updateSql).run(upgraded, user.id);
      } catch (upgradeErr) {
        console.error('[auth] Failed to upgrade legacy password hash:', upgradeErr.message);
      }
    }

    // Get role from user_roles table (many-to-many relationship)
    // CRITICAL: Admin users MUST get 'admin' role, not default to 'cashier'
    let role = null; // No default - must be fetched from database
    try {
      // Try to get role from user_roles -> roles join
      const roleResult = this.db.prepare(`
        SELECT r.code 
        FROM user_roles ur
        INNER JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = ? AND r.is_active = 1
        ORDER BY CASE r.code
          WHEN 'admin' THEN 0
          WHEN 'manager' THEN 1
          ELSE 2
        END, r.code
        LIMIT 1
      `).get(user.id);
      
      if (roleResult && roleResult.code) {
        role = roleResult.code;
      }
    } catch (error) {
      console.error('[auth] Could not fetch role from user_roles:', error.message);
    }

    // Safety fallback: If no role found, check if this is admin@pos.com and assign admin role
    if (!role && user.username === 'admin@pos.com') {
      role = 'admin';
      
      // Try to fix the database by ensuring role is linked
      try {
        // Ensure admin role exists
        this.db.prepare(`
          INSERT OR IGNORE INTO roles (id, code, name, description, is_active, created_at)
          VALUES ('role-admin-001', 'admin', 'Administrator', 'Full system access', 1, datetime('now'))
        `).run();
        
        // Link user to admin role
        this.db.prepare(`
          INSERT OR REPLACE INTO user_roles (id, user_id, role_id, assigned_at)
          VALUES ('ur-admin-001', ?, 'role-admin-001', datetime('now'))
        `).run(user.id);
      } catch (fixError) {
        console.error('[auth] Failed to auto-fix admin role:', fixError.message);
      }
    }

    if (!role) {
      role = 'cashier';
    }

    const userData = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      email: user.email || user.username,
      role,
    };

    return {
      success: true,
      user: userData,
      message: 'Welcome'
    };
  }

  /**
   * Request password reset
   * Generates a 6-digit code and stores hashed token in database
   * @param {string} identifier - Username or phone number
   * @returns {Object} { ok: true, data: { token_id, code, expires_at } }
   */
  requestPasswordReset(identifier, options = {}) {
    // Desktop IPC and web RPC both show the code on-screen (no email/SMS).
    // Pass includeCode:false only when a caller must persist a token without
    // revealing the code (rare; not used by pos:auth:requestPasswordReset RPC).
    const includeCode = options.includeCode !== false;
    if (!identifier || !identifier.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Username, email, or phone number is required');
    }

    const trimmed = identifier.trim().toLowerCase();
    const ADMIN_LOGIN_ALIASES = new Set(['admin', 'administrator']);
    const lookupId = ADMIN_LOGIN_ALIASES.has(trimmed) ? 'admin@pos.com' : trimmed;

    // Match login lookup: username, email, or phone (case-insensitive for username/email).
    const user = this.db.prepare(`
      SELECT id, username, phone, is_active 
      FROM users 
      WHERE LOWER(username) = ? OR LOWER(COALESCE(email, '')) = ? OR phone = ?
      LIMIT 1
    `).get(lookupId, lookupId, identifier.trim());

    if (!user) {
      throw createError(ERROR_CODES.NOT_FOUND, 'User not found');
    }

    if (!user.is_active) {
      throw createError(ERROR_CODES.PERMISSION_DENIED, 'User account is inactive');
    }

    // Generate 6-digit code
    const code = String(crypto.randomInt(100000, 1000000));

    // Generate salt (16 random bytes as hex)
    const salt = crypto.randomBytes(16).toString('hex');

    // Compute token_hash = SHA-256(code + "." + salt)
    const tokenHash = crypto
      .createHash('sha256')
      .update(code + '.' + salt)
      .digest('hex');

    // Set expiry to 10 minutes from now
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Insert token into database
    const tokenId = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO password_reset_tokens (
        id, user_id, token_hash, salt, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(tokenId, user.id, tokenHash, salt, expiresAt, now);

    // Return token_id and expires_at. The code is included ONLY for trusted
    // local transports; over the network it is withheld so the reset cannot be
    // completed by whoever merely requested it.
    return {
      ok: true,
      data: {
        token_id: tokenId,
        ...(includeCode ? { code } : {}),
        expires_at: expiresAt,
        code_delivered: includeCode,
      },
    };
  }

  /**
   * Confirm password reset
   * Validates token and code, then updates user password
   * @param {Object} payload - { token_id, code, new_password }
   * @returns {Object} { ok: true, data: true }
   */
  confirmPasswordReset(payload) {
    const { token_id, code, new_password } = payload;

    if (!token_id) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Token ID is required');
    }

    if (!code || !code.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Reset code is required');
    }

    if (!new_password) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'New password is required');
    }

    // Validate password length (against the trimmed value we actually store)
    if (String(new_password).trim().length < 6) {
      throw createError(
        ERROR_CODES.VALIDATION_ERROR,
        'Password must be at least 6 characters long'
      );
    }

    return this.db.transaction(() => {
      // Load token by id
      const token = this.db
        .prepare('SELECT * FROM password_reset_tokens WHERE id = ?')
        .get(token_id);

      if (!token) {
        throw createError(ERROR_CODES.TOKEN_NOT_FOUND, 'Reset token not found');
      }

      // Check if token is already used
      if (token.used_at) {
        throw createError(ERROR_CODES.TOKEN_USED, 'Reset token has already been used');
      }

      // Check if token is expired
      const now = new Date();
      const expiresAt = new Date(token.expires_at);
      if (now > expiresAt) {
        throw createError(ERROR_CODES.TOKEN_EXPIRED, 'Reset token has expired');
      }

      // Validate code: compute hash from provided code + stored salt
      const computedHash = crypto
        .createHash('sha256')
        .update(code.trim() + '.' + token.salt)
        .digest('hex');

      // Compare with stored token_hash
      if (computedHash !== token.token_hash) {
        throw createError(ERROR_CODES.TOKEN_INVALID, 'Invalid reset code');
      }

      // Hash new password with scrypt (trim to match login, which trims input).
      const passwordHash = hashPassword(String(new_password).trim());

      const userCols = this.db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
      const hasPasswordExpired = userCols.includes('password_expired');
      const updateSql = hasPasswordExpired
        ? 'UPDATE users SET password_hash = ?, password_expired = 0, updated_at = ? WHERE id = ?'
        : 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?';

      // Update user password
      this.db.prepare(updateSql).run(
        passwordHash,
        new Date().toISOString(),
        token.user_id
      );

      // Mark token as used
      this.db
        .prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?')
        .run(new Date().toISOString(), token_id);

      return { ok: true, data: true };
    })();
  }
}

module.exports = AuthService;

