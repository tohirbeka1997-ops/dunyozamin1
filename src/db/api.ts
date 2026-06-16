// Mock API facade. The implementation has been split into domain modules under
// `src/db/*.api.ts`, with shared infrastructure (mock in-memory DB, Electron IPC
// helpers, localStorage stores, id/format helpers) living in `src/db/internal.ts`.
//
// This file only re-exports those modules so existing `@/db/api` import paths keep
// working unchanged. Add new functionality to the relevant domain module instead.

import { getProfiles, updateProfile } from './internal';

// Shared profile stubs (kept here for the historical `@/db/api` import path).
export { getProfiles, updateProfile };

export * from './auth.api';
export * from './products.api';
export * from './inventory.api';
export * from './customers.api';
export * from './shifts.api';
export * from './orders.api';
export * from './salesReturns.api';
export * from './purchaseOrders.api';
export * from './purchasing.api';
export * from './quotes.api';
export * from './customerCredit.api';
export * from './suppliers.api';
export * from './catalog.api';
export * from './exchangeRates.api';
export * from './employees.api';
export * from './expenses.api';
export * from './heldOrders.api';
export * from './settings.api';
export * from './dashboard.api';
