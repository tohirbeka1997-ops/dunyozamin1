'use strict';

const {
  MAIN_WAREHOUSE_ID,
  decrementStockForPaidWebOrder,
  fulfillWebOrderStock,
  reserveWebOrderStock,
  releaseWebOrderStock,
  restoreWebOrderStock,
  handleWebOrderCancelled,
  markCashPaymentOnDelivered,
  isOrderStockFulfilled,
} = require('./webOrderStock.cjs');

module.exports = {
  MAIN_WAREHOUSE_ID,
  decrementStockForPaidWebOrder,
  fulfillWebOrderStock,
  reserveWebOrderStock,
  releaseWebOrderStock,
  restoreWebOrderStock,
  handleWebOrderCancelled,
  markCashPaymentOnDelivered,
  isOrderStockFulfilled,
};
