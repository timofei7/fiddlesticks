import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// The cloudflare plugin runs worker/index.js (and the Room Durable Object)
// inside workerd during `vite dev`, so local dev matches production.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
