import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('biometrics defines two-minute grace and foreground subscribe', () => {
  const bioPath = path.resolve(__dirname, '../biometrics.ts');
  const source = fs.readFileSync(bioPath, 'utf8');
  assert.match(source, /BIOMETRIC_LOCK_GRACE_MS = 2 \* 60 \* 1000/);
  assert.match(source, /shouldRequireBiometricLock/);
  assert.match(source, /initBiometricActivityTracking/);
  assert.match(source, /subscribeBiometricForeground/);
  assert.match(source, /isBiometricAvailable/);
  // Must NOT reset grace clock on foreground before unlock check
  assert.doesNotMatch(
    source,
    /state === 'active'[\s\S]{0,80}touchAppActive/,
  );
});

test('locked screen offers password login and logout copy', () => {
  const indexPath = path.resolve(__dirname, '../../../app/index.tsx');
  const source = fs.readFileSync(indexPath, 'utf8');
  assert.match(source, /loginWithPassword/);
  assert.match(source, /clearSessionAndGoToLogin/);
  assert.match(source, /shouldRequireBiometricLock/);
});

test('root layout mounts BiometricLockGate and activity tracking', () => {
  const layoutPath = path.resolve(__dirname, '../../../app/_layout.tsx');
  const gatePath = path.resolve(__dirname, '../../components/BiometricLockGate.tsx');
  const layout = fs.readFileSync(layoutPath, 'utf8');
  const gate = fs.readFileSync(gatePath, 'utf8');
  assert.match(layout, /BiometricLockGate/);
  assert.match(layout, /initBiometricActivityTracking/);
  assert.match(gate, /subscribeBiometricForeground/);
  assert.match(gate, /shouldRequireBiometricLock/);
});
