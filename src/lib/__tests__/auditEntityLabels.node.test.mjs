import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auditEntityTypeLabel } from '../auditEntityLabels.ts';

describe('auditEntityLabels', () => {
  it('maps known entity_type codes to Uzbek labels', () => {
    assert.equal(auditEntityTypeLabel('price'), "Narx o'zgarishi");
    assert.equal(auditEntityTypeLabel('product'), 'Mahsulot');
    assert.equal(auditEntityTypeLabel('purchase_order'), 'Xarid buyurtmasi');
    assert.equal(auditEntityTypeLabel('return'), 'Qaytarish');
    assert.equal(auditEntityTypeLabel('customer'), 'Mijoz');
    assert.equal(auditEntityTypeLabel('supplier'), 'Yetkazib beruvchi');
  });

  it('falls back to raw code for unknown types', () => {
    assert.equal(auditEntityTypeLabel('custom_thing'), 'custom_thing');
  });
});
