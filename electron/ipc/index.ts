import { registerProductsHandlers } from './products.ipc';
import { registerCategoriesHandlers } from './categories.ipc';
import { registerCustomersHandlers } from './customers.ipc';

/**
 * Register all IPC handlers
 */
export function registerAllHandlers(): void {
  registerProductsHandlers();
  registerCategoriesHandlers();
  registerCustomersHandlers();
  // Register other handlers as we create them
}
