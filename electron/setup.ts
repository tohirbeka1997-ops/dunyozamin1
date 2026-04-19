import { app } from 'electron';
import { getDb, closeDb } from './db/index';
import { registerAllHandlers } from './ipc/index';

/**
 * Initialize database and register IPC handlers
 * Called from main.cjs after app is ready
 */
export function initializeBackend(): void {
  try {
    // Initialize database (runs migrations automatically)
    getDb();
    console.log('Database initialized successfully');

    // Register all IPC handlers
    registerAllHandlers();
    console.log('IPC handlers registered successfully');

    // Close DB on app quit
    app.on('before-quit', () => {
      closeDb();
    });
  } catch (error) {
    console.error('Error initializing backend:', error);
    throw error;
  }
}

