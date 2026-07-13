import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The frontend talks to the Express API via a dev proxy so both run on localhost.
// If an API_KEY is set (used when exposing the API publicly), the proxy injects it
// as the `x-api-key` header so the browser never has to hold the secret. The key
// lives in the repo-root .env, so we load it explicitly (Vite only auto-loads
// VITE_-prefixed vars from the app folder).
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '');
  const apiKey = env.API_KEY;
  // Where the web app's /api calls are proxied. Defaults to the local API, but
  // set API_PROXY_TARGET (e.g. the cloud Container App URL) to run fully on the
  // cloud so both assistant engines read the same cloud data.
  const target = env.API_PROXY_TARGET || 'http://localhost:4000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: true,
          headers: apiKey ? { 'x-api-key': apiKey } : undefined,
        },
      },
    },
  };
});
