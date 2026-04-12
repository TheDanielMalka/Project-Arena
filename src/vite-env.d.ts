/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENGINE_API_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_CONTRACT_ADDRESS?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_ENGINE_API_TOKEN?: string;
  readonly VITE_LANDING_HERO_VIDEO?: string;
  readonly VITE_AVATAR_CDN_BASE?: string;
  readonly VITE_IDENTITY_PORTRAITS?: string;
  readonly VITE_LEGAL_GOVERNING_LAW?: string;
  readonly VITE_LEGAL_ARBITRATION_BODY?: string;
  readonly VITE_LEGAL_ARBITRATION_SEAT?: string;
  readonly VITE_LEGAL_ENTITY_NAME?: string;
  readonly VITE_LEGAL_REGISTERED_ADDRESS?: string;
  readonly VITE_LEGAL_DPO_DETAILS?: string;
  readonly VITE_LEGAL_DPO_CONTACT?: string;
  /** Set by Vitest */
  readonly VITEST?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
