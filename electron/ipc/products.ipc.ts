import { ipcMain } from 'electron';
import * as productsRepo from '../db/products.repo';
import type { ListProductsParams, CreateProductPayload, UpdateProductPayload } from '../db/products.repo';

/**
 * Register IPC handlers for products
 */
export function registerProductsHandlers(): void {
  // products:list
  ipcMain.handle('products:list', async (_event, params: ListProductsParams) => {
    try {
      return productsRepo.listProducts(params);
    } catch (error) {
      console.error('Error in products:list:', error);
      throw error;
    }
  });

  // products:get
  ipcMain.handle('products:get', async (_event, id: string) => {
    try {
      return productsRepo.getProductById(id);
    } catch (error) {
      console.error('Error in products:get:', error);
      throw error;
    }
  });

  // products:create
  ipcMain.handle('products:create', async (_event, payload: CreateProductPayload) => {
    try {
      return productsRepo.createProduct(payload);
    } catch (error) {
      console.error('Error in products:create:', error);
      throw error;
    }
  });

  // products:update
  ipcMain.handle('products:update', async (_event, payload: UpdateProductPayload) => {
    try {
      return productsRepo.updateProduct(payload);
    } catch (error) {
      console.error('Error in products:update:', error);
      throw error;
    }
  });

  // products:remove
  ipcMain.handle('products:remove', async (_event, id: string) => {
    try {
      productsRepo.removeProduct(id);
      return { success: true };
    } catch (error) {
      console.error('Error in products:remove:', error);
      throw error;
    }
  });
}





















































