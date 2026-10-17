import { createServer, provideServerModules } from '@rpgjs/server';
import { provideTiledMap } from '@rpgjs/tiledmap/server';
import { provideLesson } from './modules/lesson';

export default createServer({
  providers: [
    provideLesson(),
    provideServerModules([]),
    provideTiledMap({ basePath: '/rpgjs/map' }),
  ],
});
