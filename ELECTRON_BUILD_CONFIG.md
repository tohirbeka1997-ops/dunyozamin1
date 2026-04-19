# Electron Builder Configuration - Windows EXE Packaging

## Configuration Overview

### package.json Build Config

```json
{
  "build": {
    "appId": "com.pos.tizimi.app",
    "productName": "POS Tizimi",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "package.json",
      "electron/**/*"
    ],
    "extraFiles": [
      {
        "from": "electron/db/migrations",
        "to": "electron/db/migrations",
        "filter": ["**/*"]
      }
    ],
    "asar": true,
    "asarUnpack": [
      "**/better-sqlite3/**/*"
    ],
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ],
      "icon": "public/favicon.png",
      "requestedExecutionLevel": "asInvoker"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "POS Tizimi"
    }
  }
}
```

## Key Configuration Details

### 1. Output Directory
- **Location**: `release/`
- Configured via `directories.output`

### 2. Included Files
- `dist/**/*` - Frontend build output
- `package.json` - Package metadata
- `electron/**/*` - Electron main process files
- Database migrations included via `extraFiles`

### 3. better-sqlite3 Native Module Handling

#### Configuration:
- **Location**: `devDependencies` (electron-builder will include it)
- **Rebuild**: Handled by `postinstall` script
- **ASAR Unpack**: Native modules unpacked via `asarUnpack`

#### Why `asarUnpack`?
Native modules like `better-sqlite3` cannot run from ASAR archives. They must be unpacked to the filesystem.

#### Postinstall Script:
```json
"postinstall": "electron-builder install-app-deps"
```

This script:
1. Rebuilds native modules for the correct Electron version
2. Ensures better-sqlite3 is compiled for the target platform
3. Runs automatically after `npm install`

### 4. Windows NSIS Installer

#### Target Configuration:
- **Installer Type**: NSIS (Nullsoft Scriptable Install System)
- **Architecture**: x64 only
- **Execution Level**: `asInvoker` (no admin required)

#### NSIS Options:
- **OneClick**: `false` - User can customize installation
- **Allow Directory Change**: `true` - User can choose install location
- **Desktop Shortcut**: `true` - Creates desktop shortcut
- **Start Menu Shortcut**: `true` - Creates start menu entry

## Scripts

### Development
```bash
npm run electron:dev
```
- Builds TypeScript
- Starts Vite dev server
- Launches Electron with dev server URL

### Production Build
```bash
npm run dist:win
```
- Runs `npm run build` (Vite build)
- Packages with electron-builder for Windows x64
- Creates NSIS installer in `release/` directory

### Rebuild Native Modules
```bash
npm run rebuild
```
- Rebuilds native modules (better-sqlite3) for current Electron version
- Useful if Electron version changes

## Build Process

1. **Frontend Build**: `npm run build`
   - Vite builds React app to `dist/`

2. **Native Module Rebuild**: `electron-builder install-app-deps`
   - Rebuilds better-sqlite3 for Electron version

3. **Packaging**: `electron-builder --win --x64`
   - Packages app into ASAR archive
   - Unpacks native modules
   - Includes all specified files
   - Creates NSIS installer

## Output Location

After running `npm run dist:win`:

```
release/
  ├── POS Tizimi Setup 0.0.1.exe    # NSIS installer (for distribution)
  ├── POS Tizimi Setup 0.0.1.exe.blockmap  # Update verification
  ├── latest.yml                     # Auto-updater metadata
  └── win-unpacked/                  # Unpacked app (for testing)
      ├── POS Tizimi.exe
      ├── resources/
      │   ├── app.asar               # Main app bundle
      │   └── app.asar.unpacked/     # Native modules (better-sqlite3)
      └── ...
```

## Testing the Installer

### Option 1: Run Unpacked Version
```bash
cd release/win-unpacked
./POS Tizimi.exe
```

### Option 2: Install from EXE
1. Run `release/POS Tizimi Setup 0.0.1.exe`
2. Follow installation wizard
3. Launch from desktop shortcut or start menu

## Troubleshooting

### better-sqlite3 Not Working in Packaged Build

**Symptoms**: Module not found or load errors

**Solutions**:
1. Ensure `postinstall` runs: `npm run rebuild`
2. Check `asarUnpack` includes better-sqlite3
3. Verify Electron version matches: `npm run electron:start` works in dev

### Missing Database Migrations

**Symptoms**: Database errors on first run

**Solutions**:
1. Verify `extraFiles` includes migrations directory
2. Check migrations are in `electron/db/migrations/`
3. Verify paths in packaged app: `release/win-unpacked/resources/app.asar.unpacked/electron/db/migrations/`

### Build Fails

**Solutions**:
1. Clear cache: `rm -rf node_modules release dist`
2. Reinstall: `npm install`
3. Rebuild: `npm run rebuild`
4. Try again: `npm run dist:win`

## Verification Checklist

- ✅ `npm run electron:dev` works
- ✅ `npm run build` succeeds
- ✅ `npm run dist:win` creates installer
- ✅ Installer appears in `release/`
- ✅ Installed app runs and creates database
- ✅ better-sqlite3 works in packaged app
- ✅ Database migrations run on first launch

## Commands Summary

```bash
# Development
npm run electron:dev

# Production build + package
npm run dist:win

# Rebuild native modules
npm run rebuild

# Installer location
release/POS Tizimi Setup 0.0.1.exe
```





















































