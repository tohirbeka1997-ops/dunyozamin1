"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeBackend = initializeBackend;
const electron_1 = require("electron");
const index_1 = require("./db/index");
const index_2 = require("./ipc/index");
/**
 * Initialize database and register IPC handlers
 * Called from main.cjs after app is ready
 */
function initializeBackend() {
    try {
        // Initialize database (runs migrations automatically)
        (0, index_1.getDb)();
        console.log('Database initialized successfully');
        // Register all IPC handlers
        (0, index_2.registerAllHandlers)();
        console.log('IPC handlers registered successfully');
        // Close DB on app quit
        electron_1.app.on('before-quit', () => {
            (0, index_1.closeDb)();
        });
    }
    catch (error) {
        console.error('Error initializing backend:', error);
        throw error;
    }
}




















































