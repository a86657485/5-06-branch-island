import { createModule } from '@rpgjs/common';
import server from './server';
export function provideLesson(){return createModule('lesson',[{server}]);}
