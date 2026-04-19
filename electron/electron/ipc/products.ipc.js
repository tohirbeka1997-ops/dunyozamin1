"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProductsHandlers = registerProductsHandlers;
const electron_1 = require("electron");
const productsRepo = __importStar(require("../db/products.repo"));
/**
 * Register IPC handlers for products
 */
function registerProductsHandlers() {
    // products:list
    electron_1.ipcMain.handle('products:list', async (_event, params) => {
        try {
            return productsRepo.listProducts(params);
        }
        catch (error) {
            console.error('Error in products:list:', error);
            throw error;
        }
    });
    // products:get
    electron_1.ipcMain.handle('products:get', async (_event, id) => {
        try {
            return productsRepo.getProductById(id);
        }
        catch (error) {
            console.error('Error in products:get:', error);
            throw error;
        }
    });
    // products:create
    electron_1.ipcMain.handle('products:create', async (_event, payload) => {
        try {
            return productsRepo.createProduct(payload);
        }
        catch (error) {
            console.error('Error in products:create:', error);
            throw error;
        }
    });
    // products:update
    electron_1.ipcMain.handle('products:update', async (_event, payload) => {
        try {
            return productsRepo.updateProduct(payload);
        }
        catch (error) {
            console.error('Error in products:update:', error);
            throw error;
        }
    });
    // products:remove
    electron_1.ipcMain.handle('products:remove', async (_event, id) => {
        try {
            productsRepo.removeProduct(id);
            return { success: true };
        }
        catch (error) {
            console.error('Error in products:remove:', error);
            throw error;
        }
    });
}
