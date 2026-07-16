import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 백엔드 CORS 허용 포트(1420)에 맞춤 (Tauri 기본 포트와 동일)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
  },
})
