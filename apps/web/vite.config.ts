import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend talks to the Express API via a dev proxy so both run on localhost.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
