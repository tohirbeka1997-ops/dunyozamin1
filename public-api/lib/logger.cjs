'use strict';

const pino = require('pino');

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const usePretty = process.env.PINO_PRETTY === '1';

const logger = pino({
  name: 'public-api',
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  redact: {
    paths: [
      'phone',
      'password',
      'token',
      'access_token',
      'refresh_token',
      'authorization',
      'req.headers.authorization',
      'headers.authorization',
      '*.phone',
      '*.password',
      '*.token',
      '*.access_token',
      '*.refresh_token',
      'telegram_id',
      '*.telegram_id',
      'initData',
      '*.initData',
    ],
    censor: '[REDACTED]',
  },
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }
    : {}),
});

module.exports = { logger };
