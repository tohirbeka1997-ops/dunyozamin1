const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');

function registerPrintHandlers(services) {
  ipcMain.handle(
    'pos:print:receipt',
    wrapHandler(async (_event, payload) => {
      if (!services?.print?.printReceipt) {
        throw new Error('Print service not available');
      }
      return services.print.printReceipt(payload);
    })
  );
}

module.exports = { registerPrintHandlers };
