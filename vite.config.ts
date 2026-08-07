import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // Running the WPF shell against this dev server makes WebView2 write its runtime
      // cache/history under desktop/**/bin/**/*.WebView2/ — without this, Vite treats those
      // writes as source changes and full-reloads the page constantly while testing.
      ignored: ["**/desktop/**"],
    },
  },
})
