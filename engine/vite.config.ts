import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { rpgjs, tiledMapFolderPlugin } from '@rpgjs/vite';
import vue from '@vitejs/plugin-vue';
import startServer from './src/server';

function focusSourceStamp() {
  return {
    name: 'focus-source-stamp',
    apply: 'build' as const,
    closeBundle() {
      const sourcePath = resolve(import.meta.dirname, '../public/focus.mjs');
      const hash = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
      writeFileSync(resolve(import.meta.dirname, '../public/rpgjs/focus-source.txt'), `public/focus.mjs ${hash}\n`);
    }
  };
}

export default defineConfig({
  base: '/rpgjs/',
  build: {
    outDir: '../public/rpgjs',
    emptyOutDir: true,
    sourcemap: false,
  },
  optimizeDeps: {
    include: ['pixi.js > @xmldom/xmldom']
  },
  plugins: [
    focusSourceStamp(),
    vue(),
    tiledMapFolderPlugin({
      sourceFolder: './src/tiled',
      publicPath: '/map',
      buildOutputPath: 'map'
    }),
    ...rpgjs({
      server: startServer
    })
  ], 
});
