/**
 * Categories service + RPC dispatch smoke test.
 *   node electron/services/categories.smoke.test.cjs
 */
const assert = require('assert');
const Database = require('better-sqlite3');

const CategoriesService = require('./categoriesService.cjs');
const { createRpcDispatcher } = require('../net/rpcDispatch.cjs');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      image_url TEXT,
      show_in_marketplace INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      name TEXT
    );
  `);
  return db;
}

function runServiceTests() {
  const db = makeDb();
  const svc = new CategoriesService(db);

  const root = svc.create({ name: 'Santexnika', sort_order: 1 });
  const mid = svc.create({ name: 'Fiting', parent_id: root.id, sort_order: 1 });
  const leaf = svc.create({ name: 'Atvod', parent_id: mid.id, sort_order: 1 });

  assert.strictEqual(svc.getById(leaf.id).parent_id, mid.id);
  assert.throws(
    () => svc.update(mid.id, { parent_id: leaf.id }),
    /cycle/i
  );

  let parentId = null;
  let deepestId = null;
  for (let i = 0; i < 8; i += 1) {
    const row = svc.create({ name: `Level-${i + 1}`, parent_id: parentId });
    deepestId = row.id;
    parentId = row.id;
  }
  assert.throws(
    () => svc.create({ name: 'Too deep', parent_id: deepestId }),
    /hierarchy/i
  );

  const list = svc.list({});
  assert.ok(list.some((c) => c.id === leaf.id && c.products_count === 0));

  // rollupProductCounts must not stack-overflow on accidental parent cycles.
  const cycA = svc.create({ name: 'Cycle-A' });
  const cycB = svc.create({ name: 'Cycle-B', parent_id: cycA.id });
  db.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').run(cycB.id, cycA.id);
  const cyclicList = svc.list({});
  assert.ok(cyclicList.some((c) => c.id === cycA.id));
  console.log('✓ CategoriesService hierarchy tests passed');
}

async function runRpcTests() {
  const db = makeDb();
  const categories = new CategoriesService(db);
  const root = categories.create({ name: 'Root' });
  const child = categories.create({ name: 'Child', parent_id: root.id });

  const services = { categories };
  const dispatch = createRpcDispatcher({ services, db, sessions: null });

  const got = await dispatch('pos:categories:get', [child.id]);
  assert.strictEqual(got.name, 'Child');
  assert.strictEqual(got.parent_id, root.id);
  console.log('✓ rpcDispatch pos:categories:get uses getById');

  const listed = await dispatch('pos:categories:list', [{}]);
  assert.ok(Array.isArray(listed));
  assert.ok(listed.some((c) => c.id === child.id));
  console.log('✓ rpcDispatch pos:categories:list returns array');
}

(async () => {
  runServiceTests();
  await runRpcTests();
  console.log('All category smoke tests passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
