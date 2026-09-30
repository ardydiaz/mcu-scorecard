import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Must match CLIENT_URL in backend/.env
    port: 6001,
    strictPort: true,
  },
});
