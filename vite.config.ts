import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: 'src/popup/popup.html',
        viewer: 'src/viewer/viewer.html',
        library: 'src/library/library.html',
        settings: 'src/settings/settings.html',
      },
    },
  },
});
