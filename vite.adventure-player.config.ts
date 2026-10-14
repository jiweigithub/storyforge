import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  publicDir: false,
  // This portable player has no deployment-specific service configuration.
  envPrefix: [],
  plugins: [react()],
  define: { __STORYFORGE_BUILD_SHA__: JSON.stringify('standalone-player') },
  build: {
    outDir: 'dist-adventure-player',
    rollupOptions: { input: 'adventure-web.html' },
  },
})
