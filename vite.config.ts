import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy = { '/api': `http://127.0.0.1:${env.PORT || 4000}` }
  return {
    root: 'web',
    plugins: [react(), tailwind()],
    server: { host: 'localhost', strictPort: true, proxy },
    preview: { host: 'localhost', proxy },
    build: { outDir: '../dist', emptyOutDir: true },
  }
})
