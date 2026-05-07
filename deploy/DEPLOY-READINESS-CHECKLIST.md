# Deploy Readiness Checklist

This checklist is for prepare-only verification before running any real deploy command.

## Local Gates

Run these from the repository root:

```bash
npm run test:public-api
npm run test:barcode
npm run electron:build
npm run mini-app:build
npm run build
```

For changed CommonJS files, also run syntax checks:

```bash
node --check public-api/routes/catalog.cjs
node --check scripts/deploy-server.cjs
node --check scripts/deploy-web.cjs
node --check scripts/deploy-mini-app.cjs
```

## Required Server Environment

Configure these values on the server or in `deploy/deploy.env` as appropriate. Do not commit real secrets.

### Deploy Access

- `DEPLOY_SERVER`
- `SSH_IDENTITY_FILE` or `SSH_KEY`
- `REMOTE_PATH`
- `DEPLOY_APP_PATH`
- `DEPLOY_HEALTH_URL`
- `DEPLOY_RESTART_SERVICES`

### POS RPC / Admin Web

- `POS_HOST_SECRET`
- `VITE_POS_RPC_URL`
- `VITE_POS_RPC_SECRET`
- `POS_CORS_ORIGINS`
- `POS_TRUST_PROXY`

### Public API / Mini App

- `PUBLIC_API_DB_PATH` or `POS_DATA_DIR`
- `PUBLIC_API_CORS_ORIGINS`
- `PUBLIC_API_TRUST_PROXY`
- `JWT_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_INTERNAL_SECRET`
- `PUBLIC_API_TRENDING_CACHE_MS`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`

### Telegram Mini App Build

- `VITE_PUBLIC_API_URL` if the mini app does not use same-origin `/v1`
- BotFather Web App URL must be HTTPS

## Server Prerequisites

- Node.js 20 or newer.
- `ssh` access from the deploy machine.
- `rsync` or `scp` available on the deploy machine.
- Native build toolchain for `better-sqlite3` rebuilds.
- SQLite database path exists and is readable by the runtime user.
- `public-api.service` and `telegram-bot.service` exist if using systemd.
- Nginx routes `/v1` to `public-api` and admin RPC routes to the POS server as designed.

## Systemd / Path Alignment

If deploying to `/opt/pos`, prefer the `/opt/pos` examples:

- `deploy/public-api.opt-pos.service.example`
- `deploy/telegram-bot.opt-pos.service.example` if present, otherwise adapt `telegram/telegram-bot.service.example`

Check every service for:

- `WorkingDirectory`
- `EnvironmentFile`
- `ExecStart`
- runtime `User`
- database directory permissions

## Nginx Checks

- `server_name` matches the real domain.
- TLS is configured before Telegram Web App launch.
- Static roots point to the current release symlinks.
- `/v1` proxies to `127.0.0.1:3334`.
- Admin RPC routes proxy to the POS RPC server if used.
- Gzip or Brotli is enabled for static assets.
- Cache immutable assets under `/assets/`, but do not cache API responses that contain user/order state.

## Final Pre-Deploy Smoke

Before running deploy:

```bash
curl -fsS http://127.0.0.1:3333/health
curl -fsS http://127.0.0.1:3334/health
npm run telegram:verify
```

After deploy, verify:

- Admin web loads and logs in.
- Mini app opens from Telegram.
- `/v1/categories`, `/v1/products`, and `/v1/products/trending` return valid JSON.
- A test web order can be created and appears in admin web orders.
- Telegram bot receives and sends expected order notifications.

