const { ERROR_CODES, createError } = require('../lib/errors.cjs');
const { randomUUID } = require('crypto');
const crypto = require('crypto');

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

    const trimmedUsername = username.trim().toLowerCase();
    const trimmedPassword = password.trim();
    
    console.log('🔍 AuthService.login: Searching for user with username:', trimmedUsername);

    // Query users table - check both username and email fields
    const stmt1 = this.db.prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?');
    const user = stmt1.get(trimmedUsername, trimmedUsername);
    
    console.log('🔍 Query result:', user ? 'Found' : 'Not found');
    
    // Check if user exists
    if (!user) {
      console.error('❌ AuthService.login: User not found for username:', trimmedUsername);
      return { success: false, error: 'Invalid credentials' };
    }

    // Check if user is active
    if (!user.is_active) {
      console.error('❌ AuthService.login: User account is inactive');
      return { success: false, error: 'User account is inactive' };
    }

    // Pre-check: If user has no password set, automatically set default password '12345'
    // This is a temporary fix to ensure existing users can log in
    if (!user.password_hash) {
      console.warn('⚠️  AuthService.login: User has no password set, setting default password');
      const defaultPasswordHash = crypto.createHash('sha256').update('12345').digest('hex');
      
      try {
        this.db.prepare(`
          UPDATE users 
          SET password_hash = ?, updated_at = datetime('now') 
          WHERE id = ?
        `).run(defaultPasswordHash, user.id);
        
        console.log('✅ Default password set for user:', user.username);
        // Update user object with new password_hash
        user.password_hash = defaultPasswordHash;
      } catch (error) {
        console.error('❌ Failed to set default password:', error);
        return { success: false, error: 'Account setup error. Please contact administrator.' };
      }
    }

    // Verify password
    // For now, use SHA-256 (matching seed data)
    // TODO: Migrate to bcrypt for production
    const passwordHash = crypto.createHash('sha256').update(trimmedPassword).digest('hex');
    
    // Compare password hash
    if (passwordHash !== user.password_hash) {
      console.error('❌ AuthService.login: Password mismatch');
      console.error('   Expected hash:', user.password_hash);
      console.error('   Provided hash:', passwordHash);
      return { success: false, error: 'Invalid credentials' };
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
        ORDER BY ur.assigned_at DESC
        LIMIT 1
      `).get(user.id);
      
      if (roleResult && roleResult.code) {
        role = roleResult.code;
        console.log('✅ Role retrieved from database:', role);
      } else {
        console.warn('⚠️  No active role found for user:', user.username, user.id);
      }
    } catch (error) {
      // user_roles or roles table might not exist
      console.error('❌ Could not fetch role from user_roles:', error.message);
    }
    
    // Safety fallback: If no role found, check if this is admin@pos.com and assign admin role
    if (!role && user.username === 'admin@pos.com') {
      console.warn('⚠️  Admin user has no role assigned, defaulting to admin');
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
        
        console.log('✅ Auto-fixed admin role assignment in database');
      } catch (fixError) {
        console.error('❌ Failed to auto-fix admin role:', fixError.message);
      }
    }
    
    // Final fallback: Use 'cashier' only if user is definitely not admin
    if (!role) {
      console.warn('⚠️  No role found, defaulting to cashier for user:', user.username);
      role = 'cashier';
    }

    // Return user without password_hash
    const { password_hash, ...userWithoutPassword } = user;
    
    // Ensure role is set (should not be null at this point)
    if (!role) {
      console.error('❌ CRITICAL: Role is still null after all checks for user:', user.username);
      role = 'cashier'; // Last resort fallback
    }
    
    const userData = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      email: user.email || user.username,
      role: role, // Role must be set (admin, cashier, or manager)
    };
    
    console.log('✅ Final user data with role:', { username: userData.username, role: userData.role });

    console.log('✅ AuthService.login: Login successful for user:', userData.username);
    
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
  requestPasswordReset(identifier) {
    if (!identifier || !identifier.trim()) {
      throw createError(ERROR_CODES.VALIDATION_ERROR, 'Username or phone number is required');
    }

    // Find user by username or phone
    const user = this.db.prepare(`
      SELECT id, username, phone, is_active 
      FROM users 
      WHERE username = ? OR phone = ? 
      LIMIT 1
    `).get(identifier.trim(), identifier.trim());

    if (!user) {
      throw createError(ERROR_CODES.NOT_FOUND, 'User not found');
    }

    if (!user.is_active) {
      throw createError(ERROR_CODES.PERMISSION_DENIED, 'User account is inactive');
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));

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

    // Return token_id, code (only time code is returned), and expires_at
    return {
      ok: true,
      data: {
        token_id: tokenId,
        code: code, // Only returned here, never logged
        expires_at: expiresAt,
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

    // Validate password length
    if (new_password.length < 6) {
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

      // Hash new password using SHA-256 (for consistency with current system)
      // Note: Ideally should use bcrypt, but using SHA-256 to match existing auth
      const passwordHash = crypto.createHash('sha256').update(new_password).digest('hex');

      // Update user password
      this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
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

