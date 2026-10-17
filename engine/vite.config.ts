import { defineConfig } from 'vite';
import { rpgjs, tiledMapFolderPlugin } from '@rpgjs/vite';
import vue from '@vitejs/plugin-vue';
import startServer from './src/server';

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
