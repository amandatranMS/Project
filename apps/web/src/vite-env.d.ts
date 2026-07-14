/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Entra application (client) id — enables Microsoft login when set. */
  readonly VITE_AAD_CLIENT_ID?: string;
  /** Entra directory (tenant) id of the Foundry tenant. */
  readonly VITE_AAD_TENANT_ID?: string;
  /** Optional redirect URI; defaults to the current origin. */
  readonly VITE_AAD_REDIRECT_URI?: string;
  /** Exposed API scope, e.g. api://<clientId>/access_as_user. */
  readonly VITE_API_SCOPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

