/**
 * Get the database path used by the Electron app
 * This script simulates what Electron does to find the userData path
 */

const path = require('path');
const os = require('os');

// On Windows, Electron uses: %APPDATA%\POS Tizimi\pos.db
// This is typically: C:\Users\<username>\AppData\Roaming\POS Tizimi\pos.db

function getElectronUserDataPath() {
  const platform = process.platform;
  const appName = 'POS Tizimi';
  
  if (platform === 'win32') {
    // Windows: %APPDATA%\POS Tizimi
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, appName);
  } else if (platform === 'darwin') {
    // macOS: ~/Library/Application Support/POS Tizimi
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  } else {
    // Linux: ~/.config/POS Tizimi
    return path.join(os.homedir(), '.config', appName);
  }
}

const userDataPath = getElectronUserDataPath();
const dbPath = path.join(userDataPath, 'pos.db');

console.log('Electron UserData Path:', userDataPath);
console.log('Database Path:', dbPath);
console.log('');
console.log('To run verification:');
console.log(`  node scripts/run_verify_stock.cjs "${dbPath}"`);
console.log(`  OR`);
console.log(`  scripts\\run_verify_stock.bat "${dbPath}"`);

