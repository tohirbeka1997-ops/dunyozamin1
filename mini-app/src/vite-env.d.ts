/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Bo'sh = bir domen (Nginx /v1 proxy) */
  readonly VITE_PUBLIC_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
