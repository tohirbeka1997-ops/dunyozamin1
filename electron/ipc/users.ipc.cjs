const { ipcMain } = require('electron');
const { wrapHandler } = require('../lib/errors.cjs');

/**
 * Users IPC Handlers
 * Channels: pos:users:*
 */
function registerUsersHandlers(services) {
  const { users } = services;

  ipcMain.removeHandler('pos:users:list');
  ipcMain.handle(
    'pos:users:list',
    wrapHandler(async (_event, filters) => {
      return users.list(filters || {});
    })
  );

  ipcMain.removeHandler('pos:users:get');
  ipcMain.handle(
    'pos:users:get',
    wrapHandler(async (_event, id) => {
      return users.get(id);
    })
  );

  ipcMain.removeHandler('pos:users:create');
  ipcMain.handle(
    'pos:users:create',
    wrapHandler(async (_event, payload) => {
      return users.create(payload || {});
    })
  );

  ipcMain.removeHandler('pos:users:update');
  ipcMain.handle(
    'pos:users:update',
    wrapHandler(async (_event, id, payload) => {
      return users.update(id, payload || {});
    })
  );

  ipcMain.removeHandler('pos:users:delete');
  ipcMain.handle(
    'pos:users:delete',
    wrapHandler(async (_event, id) => {
      return users.delete(id);
    })
  );
}

module.exports = { registerUsersHandlers };


























