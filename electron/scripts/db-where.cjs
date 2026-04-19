/**
 * Database Location Helper Script
 * 
 * Prints database location information:
 * - UserData directory path
 * - Canonical database path
 * - All database file candidates found in userData
 * - Which database is chosen/active
 * 
 * Usage: npm run db:where
 * 
 * NOTE: This MUST run via Electron to ensure correct path resolution
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function showDatabaseLocation() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              DATABASE LOCATION INFORMATION                     ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log('');
  
  try {
    // Get userData path
    const userDataPath = app.getPath('userData');
    console.log('📁 UserData Directory:');
    console.log('   ' + userDataPath);
    console.log('');
    
    // Get canonical path
    const { getDbPath, listDatabaseCandidates } = require('../db/dbPath.cjs');
    const canonicalPath = getDbPath(app);
    console.log('📄 Canonical Database Path:');
    console.log('   ' + canonicalPath);
    console.log('');
    
    // Check if canonical exists
    const canonicalExists = fs.existsSync(canonicalPath);
    if (canonicalExists) {
      const stat = fs.statSync(canonicalPath);
      console.log('   ✅ EXISTS');
      console.log('   Size: ' + (stat.size / 1024).toFixed(2) + ' KB');
      console.log('   Modified: ' + stat.mtime.toISOString());
      
      // Check for WAL/SHM files
      const walPath = canonicalPath + '-wal';
      const shmPath = canonicalPath + '-shm';
      if (fs.existsSync(walPath)) {
        const walStat = fs.statSync(walPath);
        console.log('   WAL file: ✅ (' + (walStat.size / 1024).toFixed(2) + ' KB)');
      } else {
        console.log('   WAL file: ❌ (not found)');
      }
      
      if (fs.existsSync(shmPath)) {
        const shmStat = fs.statSync(shmPath);
        console.log('   SHM file: ✅ (' + (shmStat.size / 1024).toFixed(2) + ' KB)');
      } else {
        console.log('   SHM file: ❌ (not found)');
      }
    } else {
      console.log('   ❌ DOES NOT EXIST (will be created on first run)');
    }
    console.log('');
    
    // List all database candidates
    console.log('📋 Database File Candidates in UserData:');
    const candidates = listDatabaseCandidates(app);
    
    if (candidates.length === 0) {
      console.log('   (none found)');
    } else {
      for (const candidate of candidates) {
        const isCanonical = candidate.path === canonicalPath;
        const marker = isCanonical ? '  ⭐ [CANONICAL]' : '     ';
        console.log(marker + ' ' + candidate.name);
        console.log('        Path: ' + candidate.path);
        console.log('        Size: ' + (candidate.size / 1024).toFixed(2) + ' KB');
        console.log('        Modified: ' + candidate.modified.toISOString());
      }
    }
    console.log('');
    
    // Summary
    console.log('📊 Summary:');
    console.log('   Canonical DB: ' + path.basename(canonicalPath));
    console.log('   Status: ' + (canonicalExists ? '✅ Exists' : '⚠️  Will be created'));
    console.log('   Total candidates: ' + candidates.length);
    console.log('');
    
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Error getting database location:');
    console.error('   ' + error.message);
    if (error.stack) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }
    console.error('');
    process.exit(1);
  }
}

// Run when Electron app is ready
if (app.isReady()) {
  showDatabaseLocation();
  setTimeout(() => app.quit(), 500);
} else {
  app.once('ready', () => {
    showDatabaseLocation();
    setTimeout(() => app.quit(), 500);
  });
}

module.exports = showDatabaseLocation;




































