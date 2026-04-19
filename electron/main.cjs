const path = require('path');
require('./config/loadRootEnv.cjs').loadRootEnv();

const { app, BrowserWindow, ipcMain, shell, screen, dialog, protocol, net } = require('electron');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { createBackupRunner } = require('./services/backupManager.cjs');
const { performPendingDbReset, hasResetFlag } = require('./scripts/db-reset-pending.cjs');

let logFilePath = null;
/** Max `main.log` size before it is removed on startup (avoids multi-GB logs). */
const MAX_MAIN_LOG_BYTES = 10 * 1024 * 1024;

function setupFileLogging() {
  try {
    const userData = app.getPath('userData');
    if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
    logFilePath = path.join(userData, 'main.log');
    try {
      if (fs.existsSync(logFilePath)) {
        const { size } = fs.statSync(logFilePath);
        if (size > MAX_MAIN_LOG_BYTES) {
          fs.unlinkSync(logFilePath);
        }
      }
    } catch (e) {
      // ignore rotation/cleanup failures
    }
    fs.appendFileSync(logFilePath, `\n\n===== APP START ${new Date().toISOString()} =====\n`, 'utf8');

    const write = (level, args) => {
      try {
        const msg = args
          .map((a) => {
            if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
            if (typeof a === 'object') {
              try {
                return JSON.stringify(a);
              } catch (e) {
                return String(a);
              }
            }
            return String(a);
          })
          .join(' ');
        fs.appendFileSync(logFilePath, `[${new Date().toISOString()}] [${level}] ${msg}\n`, 'utf8');
      } catch (e) {
        // ignore logging failures
      }
    };

    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origErr = console.error.bind(console);
    console.log = (...args) => {
      write('LOG', args);
      origLog(...args);
    };
    console.warn = (...args) => {
      write('WARN', args);
      origWarn(...args);
    };
    console.error = (...args) => {
      write('ERROR', args);
      origErr(...args);
    };

    console.log('[Logging] File logging enabled:', logFilePath);
    console.log('[Logging] userData:', userData);
  } catch (e) {
    // ignore
  }
}

// ============================================================================
// ROBBUST ERROR HANDLING & LOGGING
// ============================================================================

console.log('========================================');
console.log('ELECTRON MAIN PROCESS STARTING');
console.log('========================================');
console.log('Node version:', process.versions.node);
console.log('Electron version:', process.versions.electron);
console.log('Platform:', process.platform);
console.log('Arch:', process.arch);
console.log('VITE_DEV_SERVER_URL:', process.env.VITE_DEV_SERVER_URL);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Current working directory:', process.cwd());
console.log('Main process file:', __filename);
console.log('========================================');

// Register product-image protocol (must be before app.ready)
protocol.registerSchemesAsPrivileged([
  { scheme: 'product-image', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('========================================');
  console.error('UNCAUGHT EXCEPTION in Electron main process');
  console.error('========================================');
  console.error('Error:', error);
  console.error('Stack:', error.stack);
  console.error('========================================');
  // Don't exit - let Electron handle it
});

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('========================================');
  console.error('UNHANDLED REJECTION in Electron main process');
  console.error('========================================');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  console.error('========================================');
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function resolvePath(relativePath) {
  const resolved = path.resolve(__dirname, relativePath);
  console.log(`Resolving path: ${relativePath} -> ${resolved}`);
  const exists = fs.existsSync(resolved);
  console.log(`Path exists: ${exists}`);
  if (!exists) {
    console.error(`ERROR: Path does not exist: ${resolved}`);
  }
  return resolved;
}

function buildPatchedIndexForFileProtocol(indexPath) {
  try {
    const distDir = path.dirname(indexPath);
    const baseHref = pathToFileURL(distDir + path.sep).href;
    let html = fs.readFileSync(indexPath, 'utf8');

    // Always enforce a correct <base> so any remaining relative links resolve to dist/
    if (/<base\s+/i.test(html)) {
      html = html.replace(/<base\s+[^>]*href="[^"]*"[^>]*>/i, `<base href="${baseHref}">`);
    } else {
      html = html.replace(/<head([^>]*)>/i, `<head$1>\n    <base href="${baseHref}">`);
    }

    // Rewrite absolute asset paths that break under file:// into ABSOLUTE file:// URLs
    // This avoids accidental resolution to the wrong directory (e.g. userData).
    html = html.replace(/(src|href)=\"\/assets\//g, `$1="${baseHref}assets/`);
    html = html.replace(/href=\"\/favicon\.png\"/g, `href="${baseHref}favicon.png"`);
    html = html.replace(/(src|href)=\"\/images\//g, `$1="${baseHref}images/`);

    const patchedPath = path.join(app.getPath('userData'), '__index_patched.html');
    fs.writeFileSync(patchedPath, html, 'utf8');
    console.log('[Electron] ✅ Patched index.html for file:// loading:', patchedPath);
    return patchedPath;
  } catch (e) {
    console.error('[Electron] ❌ Failed to patch index.html, falling back to original:', e);
    return indexPath;
  }
}

// ============================================================================
// WINDOW MANAGEMENT
// ============================================================================

let mainWindow = null;
let backupRunner = null;
let hostServerRef = null;
let isQuitting = false;

function createWindow() {
  console.log('========================================');
  console.log('CREATING BROWSER WINDOW');
  console.log('========================================');

  // Resolve preload path (relative to main.cjs location)
  const preloadPath = resolvePath('./preload.cjs');
  
  if (!fs.existsSync(preloadPath)) {
    const error = new Error(`Preload file not found: ${preloadPath}`);
    console.error('========================================');
    console.error('FATAL ERROR: Preload file missing');
    console.error('========================================');
    console.error(error.message);
    console.error('========================================');
    throw error;
  }

  console.log('Preload path resolved:', preloadPath);
  console.log('Preload file exists:', fs.existsSync(preloadPath));

  // Determine URL to load
  const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  
  console.log('Is dev mode:', isDev);
  console.log('Dev server URL:', devServerUrl);
  
  let loadURL;
  let allowedMainFramePrefixes = [];
  if (isDev) {
    loadURL = devServerUrl;
    console.log('Loading from dev server:', loadURL);
    allowedMainFramePrefixes = [devServerUrl];
  } else {
    // Production: load from file
    // In packaged apps, dist/ is inside app.asar. Use app.getAppPath() so we don't depend on __dirname layout.
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    console.log('Resolved production index path:', indexPath);
    const patchedIndexPath = buildPatchedIndexForFileProtocol(indexPath);
    const patchedUrl = pathToFileURL(patchedIndexPath).href;
    loadURL = patchedUrl;
    // Allow navigation only within the packaged dist folder + the patched userData HTML
    const distBase = pathToFileURL(path.dirname(indexPath) + path.sep).href;
    allowedMainFramePrefixes = [patchedUrl, distBase];
    console.log('Loading from file:', loadURL);
  }

  console.log('========================================');
  console.log('WINDOW CONFIGURATION');
  console.log('========================================');
  console.log('Load URL:', loadURL);
  console.log('Preload:', preloadPath);
  console.log('========================================');

  // --------------------------------------------------------------------------
  // RESPONSIVE WINDOW SIZE / ZOOM
  // Many users run the app on 1366x768 screens. A fixed 1400x900 window can
  // feel "too big" and overflow the work area. We size to the available
  // work area and apply a slight zoom-out on small screens for usability.
  // --------------------------------------------------------------------------
  const workArea = (() => {
    try {
      const d = screen.getPrimaryDisplay();
      return d?.workAreaSize || { width: 1400, height: 900 };
    } catch (_e) {
      return { width: 1400, height: 900 };
    }
  })();

  const defaultWidth = 1400;
  const defaultHeight = 900;
  const initialWidth = Math.min(defaultWidth, Number(workArea.width) || defaultWidth);
  const initialHeight = Math.min(defaultHeight, Number(workArea.height) || defaultHeight);
  const isSmallScreen =
    (Number(workArea.width) || defaultWidth) <= 1366 || (Number(workArea.height) || defaultHeight) <= 768;
  const initialZoomFactor = isSmallScreen ? 0.88 : 1.0;

  console.log('[Window] workAreaSize:', workArea, 'initial:', { initialWidth, initialHeight, initialZoomFactor });

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: 1024,
    minHeight: 650,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false, // Don't show until ready
  });

  console.log('BrowserWindow created successfully');

  // Security / stability: prevent accidental navigation to local disk roots like file:///D:/
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const allowed = allowedMainFramePrefixes.some((p) => url.startsWith(p));
      if (!allowed) {
        console.warn('[NavGuard] Blocked navigation:', url);
        event.preventDefault();
        // For http(s) links, open externally
        if (/^https?:\/\//i.test(url)) {
          shell.openExternal(url).catch(() => {});
        }
      }
    } catch (e) {
      // If guard errors, be safe and prevent
      console.error('[NavGuard] Error, preventing navigation:', e);
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('did-navigate', (_event, url) => {
    console.log('[Nav] did-navigate:', url);
  });
  mainWindow.webContents.on('did-navigate-in-page', (_event, url) => {
    console.log('[Nav] did-navigate-in-page:', url);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow print windows (openPrintWindow uses window.open('about:blank'))
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          // Keep it simple and safe; no preload needed for print HTML.
          show: true,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
          },
        },
      };
    }

    // For http(s) links, open externally.
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }

    // Deny everything else (prevents random file:// navigation via window.open).
    return { action: 'deny' };
  });

  // Error handlers for window
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('========================================');
    console.error('WINDOW FAILED TO LOAD');
    console.error('========================================');
    console.error('Error code:', errorCode);
    console.error('Error description:', errorDescription);
    console.error('Validated URL:', validatedURL);
    console.error('========================================');
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('========================================');
    console.error('RENDER PROCESS CRASHED');
    console.error('========================================');
    console.error('Reason:', details.reason);
    console.error('Exit code:', details.exitCode);
    console.error('========================================');
  });

  mainWindow.webContents.on('crashed', (event, killed) => {
    console.error('========================================');
    console.error('WEB CONTENTS CRASHED');
    console.error('========================================');
    console.error('Killed:', killed);
    console.error('========================================');
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    if (mainWindow) {
      mainWindow.show();
      console.log('Window shown');
      
      // Open DevTools in development
      if (isDev) {
        mainWindow.webContents.openDevTools();
        console.log('DevTools opened');
      }
    }
  });

  // Load the URL
  console.log('Loading URL:', loadURL);
  mainWindow.loadURL(loadURL).then(() => {
    console.log('URL loaded successfully');
  }).catch((error) => {
    console.error('========================================');
    console.error('FAILED TO LOAD URL');
    console.error('========================================');
    console.error('URL:', loadURL);
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    console.error('========================================');
  });

  // Apply zoom factor after the page is ready.
  // (We do this on did-finish-load so it works in both dev and prod.)
  mainWindow.webContents.on('did-finish-load', () => {
    try {
      mainWindow?.webContents?.setZoomFactor(initialZoomFactor);
      console.log('[Window] Zoom factor applied:', initialZoomFactor);
    } catch (e) {
      console.warn('[Window] Failed to apply zoom factor:', e?.message || e);
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    console.log('Window closed');
    mainWindow = null;
  });
}

// ============================================================================
// APP LIFECYCLE
// ============================================================================

app.on('ready', async () => {
  console.log('========================================');
  console.log('APP READY EVENT FIRED');
  console.log('========================================');

  try {
    setupFileLogging();

    // Register product-image protocol for local product images (works with http:// and file:// pages)
    protocol.handle('product-image', async (request) => {
      try {
        let url = request.url.replace(/^product-image:\/\//, '');
        url = decodeURIComponent(url).replace(/^\/+/, '');
        const filename = path.basename(url).replace(/\.\./g, '');
        if (!filename) return new Response(null, { status: 404 });
        const imagesDir = path.join(app.getPath('userData'), 'product-images');
        const filePath = path.join(imagesDir, filename);
        if (!fs.existsSync(filePath)) return new Response(null, { status: 404 });
        const buf = await fs.promises.readFile(filePath);
        const ext = path.extname(filename).toLowerCase();
        const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }[ext] || 'image/jpeg';
        return new Response(buf, { headers: { 'Content-Type': mime } });
      } catch (e) {
        console.warn('[product-image] Failed to serve:', request.url, e?.message);
        return new Response(null, { status: 404 });
      }
    });

    // Windows-safe DB reset: if a reset was scheduled, perform deletion BEFORE opening DB/services.
    try {
      const r = await performPendingDbReset(app);
      if (r?.performed) {
        console.log('[DBReset] Pending reset performed:', { deleted: r.deleted?.length || 0, renamed: r.renamed?.length || 0 });
      }
    } catch (e) {
      console.error('[DBReset] Pending reset failed:', e?.message || e);
      // If reset was requested, do NOT continue startup with old data (it looks like "reset didn't work").
      // Show a clear message and quit so user can retry after ensuring no locks remain.
      try {
        const requested =
          process.argv.includes('--reset-db') ||
          process.argv.includes('--resetDatabase') ||
          hasResetFlag(app);
        if (requested) {
          dialog.showMessageBoxSync({
            type: 'error',
            title: 'Database reset failed',
            message: 'Ma’lumotlar tozalanmadi (DB lock/permission).',
            detail:
              'Windows DB faylini (pos.db) o‘chira olmadi (EBUSY/EPERM).\\n\\n' +
              'Yechim:\\n' +
              '1) Ilovani to‘liq yoping (Task Manager’da ham tekshiring)\\n' +
              '2) 10-15 soniya kuting\\n' +
              '3) Ilovani qayta ochib Reset Database’ni yana bosing',
            buttons: ['OK'],
          });
          app.exit(1);
          return;
        }
      } catch {}
      // Otherwise: continue startup; user can retry reset later.
    }

    // Always register app-local config handlers first (needed for CLIENT mode)
    try {
      const { registerAppConfigHandlers } = require('./ipc/appConfig.ipc.cjs');
      registerAppConfigHandlers(app);
    } catch (e) {
      console.warn('[POSNET] Failed to register appConfig handlers:', e?.message || e);
    }

    // Read HOST/CLIENT mode config
    const { readConfig } = require('./config/appConfig.cjs');
    const appConfig = readConfig(app);
    console.log('[POSNET] Mode:', appConfig?.mode);

    if (appConfig?.mode === 'client') {
      console.log('[POSNET] CLIENT mode: DB will NOT be opened locally; forwarding IPC to HOST...');

      // Local-only handlers (OS dialogs, config)
      try {
        const { registerFilesHandlers } = require('./ipc/files.ipc.cjs');
        registerFilesHandlers();
      } catch (e) {
        console.warn('[POSNET] Failed to register local files handlers:', e?.message || e);
      }

      const { registerClientForwarders } = require('./net/clientForwarder.cjs');
      registerClientForwarders({
        hostUrl: appConfig?.client?.hostUrl,
        secret: appConfig?.client?.secret,
      });

      // Create window (renderer will talk to HOST via forwarded IPC)
      createWindow();
      return;
    }

    // HOST mode (default): Initialize backend (database, IPC handlers) + start LAN RPC server
    console.log('[POSNET] HOST mode: initializing backend + starting LAN server...');
    const { registerAllHandlers, getServices, getDbInstance } = require('./ipc/index.cjs');
    registerAllHandlers();
    console.log('Backend initialized successfully');

    // Start HOST RPC server (for LAN clients)
    try {
      const { startHostServer } = require('./net/hostServer.cjs');
      const services = getServices();
      const db = getDbInstance();
      if (services && db) {
        const bind = appConfig?.host?.bind || '0.0.0.0';
        const port = appConfig?.host?.port || 3333;
        const secret = appConfig?.host?.secret;
        const envCors = process.env.POS_RPC_CORS_ORIGINS
          ? String(process.env.POS_RPC_CORS_ORIGINS)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : null;
        const corsOrigins =
          envCors && envCors.length > 0 ? envCors : appConfig?.host?.corsOrigins || [];
        hostServerRef = startHostServer({ services, db, bind, port, secret, corsOrigins });
      } else {
        console.warn('[POSNET] HOST server not started (services/db not ready)');
      }
    } catch (e) {
      console.warn('[POSNET] Failed to start HOST server:', e?.message || e);
    }

    // Dev-only: log quick DB table counts to verify we are reading the expected pos.db
    try {
      const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
      if (isDev) {
        const db = require('./db/open.cjs').getDb();
        const counts = {
          products: db.prepare('SELECT COUNT(*) as count FROM products').get().count,
          categories: db.prepare('SELECT COUNT(*) as count FROM categories').get().count,
          customers: db.prepare('SELECT COUNT(*) as count FROM customers').get().count,
          suppliers: db.prepare('SELECT COUNT(*) as count FROM suppliers').get().count,
          orders: db.prepare('SELECT COUNT(*) as count FROM orders').get().count,
        };
        console.log('[DevCheck] DB table counts:', counts);
      }
    } catch (e) {
      console.warn('[DevCheck] Failed to read DB table counts:', e?.message || e);
    }

    // Receive renderer error logs (from preload)
    try {
      ipcMain.removeAllListeners('pos:renderer:log');
      ipcMain.on('pos:renderer:log', (_event, payload) => {
        try {
          console.error('[RendererLog]', payload);
        } catch (e) {
          // ignore
        }
      });
    } catch (e) {
      // ignore
    }

    // Start automatic DB backups (every 30 minutes, keep last 30 copies)
    try {
      backupRunner = createBackupRunner({ app, intervalMs: 30 * 60 * 1000, maxBackups: 30, enabled: true });
      backupRunner.start();
      // Create an early backup shortly after startup (gives a restore point even on first day)
      setTimeout(() => {
        backupRunner?.backupOnce('startup').catch(() => {});
      }, 10_000);
    } catch (e) {
      console.error('[Backup] Failed to start auto-backup:', e);
    }

    // Listen for database wipe completion to reload window
    ipcMain.on('database:wipe:complete', () => {
      console.log('🔄 [Main] Database wipe complete, reloading window...');
      if (mainWindow) {
        mainWindow.reload();
        console.log('✅ [Main] Window reloaded');
      }
    });

    // Create window
    createWindow();
  } catch (error) {
    console.error('========================================');
    console.error('FATAL ERROR DURING APP INITIALIZATION');
    console.error('========================================');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    console.error('========================================');
    app.quit();
  }
});

// Final backup on quit (best effort)
app.on('before-quit', async (e) => {
  if (isQuitting) return;
  isQuitting = true;
  try {
    // Stop LAN server (HOST mode) - best effort
    try {
      await Promise.race([
        hostServerRef?.close?.(),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    } catch {
      // ignore
    }

    backupRunner?.stop();
    if (backupRunner) {
      // Don't block shutdown for too long (installer/uninstaller needs the app to exit quickly).
      // We allow up to 2 seconds for a final backup, then exit anyway.
      e.preventDefault();
      const timeoutMs = 2000;
      await Promise.race([
        backupRunner.backupOnce('shutdown'),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
      // Continue quit after backup/timeout
      app.quit();
    }
  } catch (err) {
    console.error('[Backup] Shutdown backup failed:', err);
    // Allow quit even if backup fails
  }
});

app.on('window-all-closed', () => {
  console.log('All windows closed');
  // On macOS, keep app running even when all windows are closed
  // In development, don't quit on window close (allow hot reload)
  if (process.platform !== 'darwin') {
    const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
    if (!isDev) {
      app.quit();
    }
  }
});

app.on('activate', () => {
  console.log('App activated');
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  console.log('App is about to quit');
});

app.on('will-quit', () => {
  console.log('App will quit');
});

console.log('Main process script loaded successfully');
console.log('Waiting for app.ready event...');
