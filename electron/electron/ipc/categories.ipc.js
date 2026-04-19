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
exports.registerCategoriesHandlers = registerCategoriesHandlers;
const electron_1 = require("electron");
const categoriesRepo = __importStar(require("../db/categories.repo"));
function registerCategoriesHandlers() {
    electron_1.ipcMain.handle('categories:list', async () => {
        try {
            return categoriesRepo.listCategories();
        }
        catch (error) {
            console.error('Error in categories:list:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('categories:get', async (_event, id) => {
        try {
            return categoriesRepo.getCategoryById(id);
        }
        catch (error) {
            console.error('Error in categories:get:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('categories:create', async (_event, payload) => {
        try {
            return categoriesRepo.createCategory(payload);
        }
        catch (error) {
            console.error('Error in categories:create:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('categories:update', async (_event, payload) => {
        try {
            return categoriesRepo.updateCategory(payload);
        }
        catch (error) {
            console.error('Error in categories:update:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('categories:remove', async (_event, id) => {
        try {
            categoriesRepo.removeCategory(id);
            return { success: true };
        }
        catch (error) {
            console.error('Error in categories:remove:', error);
            throw error;
        }
    });
}
