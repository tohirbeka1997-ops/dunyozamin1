'use strict';

const assert = require('assert');
const {
  cogsLineSql,
  returnCogsLineSql,
  calculateNetProfit,
  soldLineRevenueUzsSql,
} = require('./unifiedSalesSql.cjs');

assert.match(
  cogsLineSql('oi'),
  /purchase_price FROM products WHERE id = oi\.product_id/,
  'cogsLineSql should fall back to products.purchase_price',
);

assert.match(
  returnCogsLineSql('oi', 'COALESCE(ri.quantity, 0)'),
  /oi\.cost_price/,
  'returnCogsLineSql should use original order_items.cost_price',
);

assert.match(
  soldLineRevenueUzsSql({ prepare: () => ({ get: () => ({ ok: 1 }) }) }, 'o', 'oi'),
  /fx_rate/,
  'soldLineRevenueUzsSql should convert USD lines via fx_rate',
);

assert.strictEqual(
  calculateNetProfit({ grossProfit: 100, returnsRevenue: 20, returnsCogs: 8, expenses: 5 }),
  83,
  'Net Profit = Gross − Returns Revenue + Returns COGS − Expenses',
);

assert.strictEqual(
  calculateNetProfit({
    grossProfit: 100,
    returnsRevenue: 20,
    returnsCogs: 8,
    expenses: 5,
    commission: 3,
  }),
  80,
  'Net Profit = Gross − Returns Revenue + Returns COGS − Expenses − Commission',
);

assert.strictEqual(
  calculateNetProfit({ grossProfit: 6000, returnsRevenue: 10000, returnsCogs: 4000, expenses: 0 }),
  6000 - 10000 + 4000,
  'partial return net profit without expenses',
);

console.log('unifiedSalesSql.test.cjs: all passed');
