/* eslint-disable no-console */
/**
 * marketplaceContent.smoke.test.cjs
 * Mini-app kontenti (promo bannerlar + kun mahsuloti) xizmati uchun smoke test:
 *   - banner CRUD + reorder
 *   - cta_link validatsiyasi (faqat /ichki yoki https://)
 *   - kun mahsuloti: pin / clear / inactive flag
 *   - "bugun" Asia/Tashkent (UTC+5) bo'yicha hisoblanishi
 *
 * Ishga tushirish: node electron/services/marketplaceContent.smoke.test.cjs
 */
'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const MarketplaceContentService = require('./marketplaceContentService.cjs');
const { formatYmdInTimeZone } = require('../lib/timezone.cjs');

function seedProducts(db) {
  db.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sale_price REAL DEFAULT 0,
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.prepare('INSERT INTO products (id, name, sale_price, is_active) VALUES (?, ?, ?, ?)')
    .run('p-active', 'Faol mahsulot', 12000, 1);
  db.prepare('INSERT INTO products (id, name, sale_price, is_active) VALUES (?, ?, ?, ?)')
    .run('p-archived', 'Arxiv mahsulot', 9000, 0);
}

function main() {
  const db = new Database(':memory:');
  seedProducts(db);
  const svc = new MarketplaceContentService(db); // _ensureSchema creates the content tables

  // ── Banner CRUD ─────────────────────────────────────────────────────────
  const created = svc.saveBanner({
    title: 'Top label',
    subtitle: 'Big headline',
    cta_text: 'Xarid →',
    cta_link: '/catalog',
    theme: 'teal',
    sort_order: 5,
  });
  assert.ok(created && created.id, 'banner created with id');
  assert.strictEqual(created.theme, 'teal');
  assert.strictEqual(created.is_active, true);
  assert.strictEqual(created.cta_link, '/catalog');

  const updated = svc.saveBanner({ id: created.id, title: 'T2', subtitle: 'S2', cta_link: 'https://example.uz/x' });
  assert.strictEqual(updated.cta_link, 'https://example.uz/x', 'https cta_link accepted');

  // ── cta_link validation: reject dangerous schemes / protocol-relative ──────
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', 'http://insecure.example']) {
    assert.throws(
      () => svc.saveBanner({ title: 'X', subtitle: 'Y', cta_link: bad }),
      /VALIDATION_ERROR|cta_link/,
      `cta_link must be rejected: ${bad}`,
    );
  }
  // empty cta_link is allowed (stored as null)
  const noCta = svc.saveBanner({ title: 'X', subtitle: 'Y', cta_link: '' });
  assert.strictEqual(noCta.cta_link, null, 'empty cta_link -> null');

  // ── Reorder ────────────────────────────────────────────────────────────
  const b2 = svc.saveBanner({ title: 'B2', subtitle: 'S', sort_order: 1 });
  svc.reorderBanners([
    { id: created.id, sort_order: 1 },
    { id: b2.id, sort_order: 2 },
  ]);
  const list = svc.listBanners({});
  const sorted = [...list].sort((a, b) => a.sort_order - b.sort_order);
  const idxCreated = sorted.findIndex((b) => b.id === created.id);
  const idxB2 = sorted.findIndex((b) => b.id === b2.id);
  assert.ok(idxCreated >= 0 && idxB2 >= 0 && idxCreated < idxB2, 'reorder applied (ASC: created before b2)');

  // listBanners activeOnly filter
  svc.saveBanner({ id: created.id, title: 'T2', subtitle: 'S2', is_active: false });
  const activeOnly = svc.listBanners({ activeOnly: true });
  assert.ok(!activeOnly.some((b) => b.id === created.id), 'inactive banner excluded by activeOnly');

  // deleteBanner
  svc.deleteBanner(b2.id);
  assert.ok(!svc.listBanners({}).some((b) => b.id === b2.id), 'banner deleted');

  // ── Daily deal: default "today" is Asia/Tashkent ──────────────────────────
  const tzToday = formatYmdInTimeZone(new Date());
  svc.setDailyDeal({ product_id: 'p-active' }); // no featured_date -> defaults to tz today
  const todayDeal = svc.getDailyDeal(); // no arg -> tz today
  assert.ok(todayDeal && todayDeal.featured_date === tzToday, 'daily deal default uses Asia/Tashkent today');
  assert.strictEqual(todayDeal.product.is_active, true, 'active product flagged active');

  // pin an archived product -> is_active=false surfaced for admin warning
  svc.setDailyDeal({ featured_date: '2030-01-01', product_id: 'p-archived', badge_text: 'x'.repeat(80) });
  const archivedDeal = svc.getDailyDeal('2030-01-01');
  assert.strictEqual(archivedDeal.product.is_active, false, 'archived product surfaced as inactive');
  assert.strictEqual(archivedDeal.badge_text.length, 60, 'badge_text clamped to 60 chars');

  // unknown product rejected
  assert.throws(() => svc.setDailyDeal({ featured_date: '2030-01-02', product_id: 'nope' }), /NOT_FOUND|not found/);

  // clear override
  svc.setDailyDeal({ featured_date: '2030-01-01', product_id: null });
  assert.strictEqual(svc.getDailyDeal('2030-01-01'), null, 'override cleared');

  // history
  const history = svc.listDailyDealHistory(10);
  assert.ok(Array.isArray(history), 'history is array');

  db.close();
  console.log('✓ marketplaceContent.smoke.test.cjs passed');
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('✗ marketplaceContent.smoke.test.cjs FAILED');
  console.error(e);
  process.exit(1);
}
