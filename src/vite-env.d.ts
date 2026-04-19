/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deployed SPA URL (Telegram Mini App), https, no trailing slash required. */
  readonly VITE_APP_PUBLIC_URL?: string;
  /** Public base URL of HOST RPC, e.g. https://your-tunnel.example/rpc host root (no trailing /rpc). */
  readonly VITE_POS_RPC_URL?: string;
  /** Same value as `host.secret` in pos-config.json (browser-visible; use only on trusted networks / tunnels). */
  readonly VITE_POS_RPC_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
