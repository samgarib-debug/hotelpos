import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// VITE_SINGLEFILE=1 inlines all JS/CSS into one index.html (offline / desktop bundle).
const singleFile = process.env.VITE_SINGLEFILE === '1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(singleFile ? [viteSingleFile()] : [])],
  server: {
    host: true,
    port: 5173,
  },
})
