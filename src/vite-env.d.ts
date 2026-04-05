/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENGINE_API_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_CONTRACT_ADDRESS?: string;
  /** Set by Vitest */
  readonly VITEST?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
