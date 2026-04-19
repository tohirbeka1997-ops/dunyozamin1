"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAllHandlers = registerAllHandlers;
const products_ipc_1 = require("./products.ipc");
const categories_ipc_1 = require("./categories.ipc");
const customers_ipc_1 = require("./customers.ipc");
/**
 * Register all IPC handlers
 */
function registerAllHandlers() {
    (0, products_ipc_1.registerProductsHandlers)();
    (0, categories_ipc_1.registerCategoriesHandlers)();
    (0, customers_ipc_1.registerCustomersHandlers)();
    // Register other handlers as we create them
}
