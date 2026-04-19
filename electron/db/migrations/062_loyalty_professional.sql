-- ============================================================================
-- Professional loyalty: general earn rules, redeem settings, advanced flags
-- orders.loyalty_redeem_points is added via migrate.cjs (safeAddColumn).
-- ============================================================================

INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public)
VALUES
  (lower(hex(randomblob(16))), 'loyalty.general.enabled', '0', 'boolean', 'Umumiy bonus ball tizimi (barcha ro''yxatdan o''tgan mijozlar)', 'sales', 1),
  (lower(hex(randomblob(16))), 'loyalty.earn.scope', 'master_only', 'string', 'Yig''ish: master_only | all_registered | exclude_walk_in', 'sales', 1),
  (lower(hex(randomblob(16))), 'loyalty.earn.points_per_uzs', '1000', 'number', 'Umumiy yig''ish: har qancha so''m to''langan summaga 1 ball', 'sales', 1),
  (lower(hex(randomblob(16))), 'loyalty.earn.min_order_uzs', '0', 'number', 'Minimal buyurtma summasi (so''m), 0 = cheklov yo''q', 'sales', 1),
  (lower(hex(randomblob(16))), 'loyalty.redeem.enabled', '0', 'boolean', 'POS da ball ishlatish (chegirma)', 'sales', 1),
  (lower(hex(randomblob(16))), 'loyalty.redeem.points_per_uzs', '100', 'number', '1 ball = necha so''m chegirma', 'sales', 1),
  (lower(hex(randomblob(16))), 'loyalty.redeem.min_points', '1', 'number', 'Bir martalik minimal ishlatiladigan ball', 'sales', 1),
  (lower(hex(randomblob(16))), 'loyalty.redeem.max_percent_of_order', '50', 'number', 'Buyurtma summasidan maksimal foiz (ball chegirmasi)', 'sales', 1),
  (lower(hex(randomblob(16))), 'loyalty.advanced.expiration_enabled', '0', 'boolean', 'Ball muddati (keyingi bosqich)', 'sales', 1),
  (lower(hex(randomblob(16))), 'loyalty.advanced.tiers_enabled', '0', 'boolean', 'Sodiqlik darajalari (keyingi bosqich)', 'sales', 1),
  (lower(hex(randomblob(16))), 'loyalty.advanced.campaigns_enabled', '0', 'boolean', 'Kampaniyalar integratsiyasi (keyingi bosqich)', 'sales', 1);
