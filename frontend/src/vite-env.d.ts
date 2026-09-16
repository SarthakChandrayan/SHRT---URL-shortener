/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string
  readonly VITE_SHORT_ORIGIN?: string
  readonly VITE_NEON_AUTH_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
