import { ipcMain } from 'electron';
import * as customersRepo from '../db/customers.repo';
import type { CreateCustomerPayload, UpdateCustomerPayload } from '../db/customers.repo';

export function registerCustomersHandlers(): void {
  ipcMain.handle('customers:list', async (_event, params?: { search?: string }) => {
    try {
      return customersRepo.listCustomers(params);
    } catch (error) {
      console.error('Error in customers:list:', error);
      throw error;
    }
  });

  ipcMain.handle('customers:get', async (_event, id: string) => {
    try {
      return customersRepo.getCustomerById(id);
    } catch (error) {
      console.error('Error in customers:get:', error);
      throw error;
    }
  });

  ipcMain.handle('customers:create', async (_event, payload: CreateCustomerPayload) => {
    try {
      return customersRepo.createCustomer(payload);
    } catch (error) {
      console.error('Error in customers:create:', error);
      throw error;
    }
  });

  ipcMain.handle('customers:update', async (_event, payload: UpdateCustomerPayload) => {
    try {
      return customersRepo.updateCustomer(payload);
    } catch (error) {
      console.error('Error in customers:update:', error);
      throw error;
    }
  });

  ipcMain.handle('customers:remove', async (_event, id: string) => {
    try {
      customersRepo.removeCustomer(id);
      return { success: true };
    } catch (error) {
      console.error('Error in customers:remove:', error);
      throw error;
    }
  });
}





















































