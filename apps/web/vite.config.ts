import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend talks to the Express API via a dev proxy so both run on localhost.
// If an API_KEY is set (used when exposing the API publicly), the proxy injects it
// as the `x-api-key` header so the browser never has to hold the secret.
const apiKey = process.env.API_KEY;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        headers: apiKey ? { 'x-api-key': apiKey } : undefined,
      },
    },
  },
});
