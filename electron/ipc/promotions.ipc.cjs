const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');

/**
 * Promotions (Aksiya) IPC Handlers
 * Channels: pos:promotions:*
 * Uses PromotionService for all CRUD (avoids requiring ESM promotions.repo from .cjs)
 */
function registerPromotionsHandlers(services) {
  if (!services) {
    throw new Error('Services object is required for registerPromotionsHandlers');
  }

  const { promotions } = services;
  if (!promotions) {
    throw new Error('Promotions service is not available');
  }

  ipcMain.removeHandler('pos:promotions:list');
  ipcMain.handle(
    'pos:promotions:list',
    wrapHandler(async (_event, filters) => {
      return promotions.listPromotionsWithStats(filters || {});
    })
  );

  ipcMain.removeHandler('pos:promotions:get');
  ipcMain.handle(
    'pos:promotions:get',
    wrapHandler(async (_event, id) => {
      const promo = promotions.getPromotionById(id);
      if (!promo) throw new Error(`Promotion ${id} not found`);
      const scope = promotions.getPromotionScope(id);
      const condition = promotions.getPromotionCondition(id);
      const reward = promotions.getPromotionReward(id);
      const usage_count = promotions.getPromotionUsageCount(id);
      const total_discount = promotions.getPromotionTotalDiscount(id);
      return {
        ...promo,
        scope,
        condition,
        reward,
        usage_count,
        total_discount,
      };
    })
  );

  ipcMain.removeHandler('pos:promotions:create');
  ipcMain.handle(
    'pos:promotions:create',
    wrapHandler(async (_event, data) => {
      return promotions.createPromotion(data);
    })
  );

  ipcMain.removeHandler('pos:promotions:update');
  ipcMain.handle(
    'pos:promotions:update',
    wrapHandler(async (_event, id, data) => {
      return promotions.updatePromotion({ ...data, id });
    })
  );

  ipcMain.removeHandler('pos:promotions:delete');
  ipcMain.handle(
    'pos:promotions:delete',
    wrapHandler(async (_event, id) => {
      promotions.deletePromotion(id);
      return { success: true };
    })
  );

  ipcMain.removeHandler('pos:promotions:activate');
  ipcMain.handle(
    'pos:promotions:activate',
    wrapHandler(async (_event, id, userId) => {
      const before = promotions.getPromotionById(id);
      promotions.setStatus(id, 'active', userId);
      promotions.audit(id, 'activate', before ? JSON.stringify({ status: before.status }) : null, JSON.stringify({ status: 'active' }), userId);
      return promotions.getPromotionById(id);
    })
  );

  ipcMain.removeHandler('pos:promotions:pause');
  ipcMain.handle(
    'pos:promotions:pause',
    wrapHandler(async (_event, id, userId) => {
      const before = promotions.getPromotionById(id);
      promotions.setStatus(id, 'paused', userId);
      promotions.audit(id, 'pause', before ? JSON.stringify({ status: before.status }) : null, JSON.stringify({ status: 'paused' }), userId);
      return promotions.getPromotionById(id);
    })
  );

  ipcMain.removeHandler('pos:promotions:applyToCart');
  ipcMain.handle(
    'pos:promotions:applyToCart',
    wrapHandler(async (_event, cartItems, customerId, promoCode) => {
      return promotions.applyPromotions(cartItems || [], customerId, promoCode);
    })
  );
}

module.exports = { registerPromotionsHandlers };
