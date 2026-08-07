import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'geojson-como-modulo',
      enforce: 'pre',
      transform(codigo, id) {
        if (!id.endsWith('.geojson')) return null
        return {
          code: `export default ${codigo.trim()}`,
          map: null,
        }
      },
    },
  ],
})
