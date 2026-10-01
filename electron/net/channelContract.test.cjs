const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { POS_CHANNELS } = require('../ipc/posChannels.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

function extractAll(filePath, regex) {
  const text = fs.readFileSync(filePath, 'utf8');
  return new Set([...text.matchAll(regex)].map((match) => match[1]));
}

test('desktop preload business channels are forwarded in CLIENT mode', () => {
  const preloadChannels = extractAll(
    path.join(ROOT, 'electron', 'preload.cjs'),
    /\binvoke\(\s*['"]([^'"]+)['"]/g,
  );
  const localPrefixes = ['pos:files:', 'pos:appConfig:', 'pos:print:'];
  const localChannels = new Set([
    'pos:auth:setSessionUser',
    'pos:database:export',
    'pos:database:uploadBegin',
    'pos:database:uploadChunk',
    'pos:database:uploadFinalize',
    'pos:database:replaceFromUpload',
    'pos:database:wipeDataOnly',
    'pos:database:wipeAllData',
    'pos:database:downloadToPc',
    'pos:database:uploadToServer',
  ]);
  const forwarded = new Set(POS_CHANNELS);
  const missing = [...preloadChannels].filter(
    (channel) =>
      !forwarded.has(channel) &&
      !localChannels.has(channel) &&
      !localPrefixes.some((prefix) => channel.startsWith(prefix)),
  );
  assert.deepEqual(missing.sort(), []);
});

test('every forwarded channel has an RPC dispatcher case', () => {
  const dispatched = extractAll(
    path.join(ROOT, 'electron', 'net', 'rpcDispatch.cjs'),
    /\bcase\s+['"]([^'"]+)['"]\s*:/g,
  );
  const missing = POS_CHANNELS.filter((channel) => !dispatched.has(channel));
  assert.deepEqual(missing.sort(), []);
});
