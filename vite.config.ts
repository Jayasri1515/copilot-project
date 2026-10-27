import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Keep condition icons as first-party files covered by CSP img-src 'self'.
    assetsInlineLimit: 0,
    manifest: true,
  },
});
