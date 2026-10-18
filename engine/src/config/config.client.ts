import { provideClientGlobalConfig, provideClientModules } from '@rpgjs/client';
import { provideTiledMap } from '@rpgjs/tiledmap/client';
import { provideVueGui, vueGui } from '@rpgjs/vue';
import LessonDialog from '../gui/LessonDialog.vue';
import FlowPanel from '../gui/FlowPanel.vue';
import { lessonSprites } from '../modules/lesson/sprites';

export default {
  providers: [
    provideTiledMap({ basePath: `${import.meta.env.BASE_URL}map` }),
    provideClientGlobalConfig({
      projectId: '5-06-smart-park',
      bootstrapCanvasOptions: { resizeTo: document.getElementById('rpg'), autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) },
      keyboardControls: {
        up: ['up', 'w'], down: ['down', 's'],
        left: ['left', 'a'], right: ['right', 'd'],
        action: ['space', 'enter', 'e'],
      },
    }),
    provideVueGui({ selector: '#vue-gui-overlay', createIfNotFound: true }),
    provideClientModules([{
      spritesheets: lessonSprites,
      gui: [vueGui({ id: 'lesson-dialog', component: LessonDialog }), vueGui({ id: 'flow-panel', component: FlowPanel })],
    }]),
  ],
};
