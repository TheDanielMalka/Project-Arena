/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENGINE_API_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_CONTRACT_ADDRESS?: string;
  /** Google OAuth Web Client ID (Google Cloud Console) — same project as engine GOOGLE_OAUTH_CLIENT_ID */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Set by Vitest */
  readonly VITEST?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
