-- Customer phone deduplication (Phase 2)
-- Re-normalize phones after the normalizePhoneUz fix that now accepts all UZ
-- operator prefixes (88/77/33/55/20 + landlines), not just 9x. The actual
-- backfill, duplicate resolution, and index creation run in migrate.cjs for 091
-- using the shared JS normalizer (phoneNormalize.cjs).
SELECT 1;
