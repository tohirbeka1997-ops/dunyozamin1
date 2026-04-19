import { ipcMain } from 'electron';
import * as categoriesRepo from '../db/categories.repo';
import type { CreateCategoryPayload, UpdateCategoryPayload } from '../db/categories.repo';

export function registerCategoriesHandlers(): void {
  ipcMain.handle('categories:list', async () => {
    try {
      return categoriesRepo.listCategories();
    } catch (error) {
      console.error('Error in categories:list:', error);
      throw error;
    }
  });

  ipcMain.handle('categories:get', async (_event, id: string) => {
    try {
      return categoriesRepo.getCategoryById(id);
    } catch (error) {
      console.error('Error in categories:get:', error);
      throw error;
    }
  });

  ipcMain.handle('categories:create', async (_event, payload: CreateCategoryPayload) => {
    try {
      return categoriesRepo.createCategory(payload);
    } catch (error) {
      console.error('Error in categories:create:', error);
      throw error;
    }
  });

  ipcMain.handle('categories:update', async (_event, payload: UpdateCategoryPayload) => {
    try {
      return categoriesRepo.updateCategory(payload);
    } catch (error) {
      console.error('Error in categories:update:', error);
      throw error;
    }
  });

  ipcMain.handle('categories:remove', async (_event, id: string) => {
    try {
      categoriesRepo.removeCategory(id);
      return { success: true };
    } catch (error) {
      console.error('Error in categories:remove:', error);
      throw error;
    }
  });
}





















































