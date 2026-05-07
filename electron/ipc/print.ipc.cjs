const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');

function registerPrintHandlers(services) {
  ipcMain.removeHandler('pos:print:receipt');
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

/**
 * CLIENT mode: chop etish serverga yuborilmaydi — faqat mahalliy printer (pos-config.json).
 * PrintService DB ishlatmaydi; `null` bazadan xavfsiz.
 */
function registerLocalPrintHandlers() {
  const PrintService = require('../services/printService.cjs');
  const printSvc = new PrintService(null);
  ipcMain.removeHandler('pos:print:receipt');
  ipcMain.handle(
    'pos:print:receipt',
    wrapHandler(async (_event, payload) => {
      return printSvc.printReceipt(payload);
    })
  );
}

module.exports = { registerPrintHandlers, registerLocalPrintHandlers };
