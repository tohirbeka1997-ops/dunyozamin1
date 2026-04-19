// Proxy for legacy `electron/electron/*` bundle.
// Some old compiled files in `electron/electron/db/*` expect `./open.cjs` to exist.
// Delegate to the canonical DB implementation, which ALWAYS uses `<userData>/pos.db`.

module.exports = require('../../db/open.cjs');

