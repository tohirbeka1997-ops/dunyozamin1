'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ERROR_CODES } = require('../electron/lib/errors.cjs');
const { mapStaffServiceError } = require('./lib/staffErrorMap.cjs');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

test('mapStaffServiceError maps shift_closed to 409', () => {
  const res = mockRes();
  mapStaffServiceError(Object.assign(new Error('Smena yopiq'), { code: ERROR_CODES.SHIFT_CLOSED }), res, {
    logTag: '[test]',
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'shift_closed');
});

test('mapStaffServiceError maps RETURN_LIMIT_EXCEEDED to 409', () => {
  const res = mockRes();
  mapStaffServiceError(
    Object.assign(new Error('Sotuv to‘liq qaytarilgan'), {
      code: ERROR_CODES.RETURN_LIMIT_EXCEEDED,
    }),
    res,
    { logTag: '[test]' },
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'RETURN_LIMIT_EXCEEDED');
  assert.equal(res.body.error, 'return_limit_exceeded');
});

test('mapStaffServiceError maps CONFLICT to 409', () => {
  const res = mockRes();
  mapStaffServiceError(
    Object.assign(new Error('Cannot return over available qty'), { code: ERROR_CODES.CONFLICT }),
    res,
    { logTag: '[test]' },
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'conflict');
});

test('mapStaffServiceError maps SQLITE errors to database_error', () => {
  const res = mockRes();
  mapStaffServiceError(Object.assign(new Error('no such column: currency'), { code: 'SQLITE_ERROR' }), res, {
    logTag: '[test]',
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'database_error');
  assert.match(res.body.message, /Migratsiyalarni/);
});

test('mapStaffServiceError avoids generic Internal error fallback', () => {
  const res = mockRes();
  mapStaffServiceError(new Error('Request failed'), res, { logTag: '[test]' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, 'Ichki xato. Qayta urinib ko‘ring.');
});
