import { defineModule } from '@rpgjs/common';
import type { RpgServer } from '@rpgjs/server';
import { player } from './player';
import { greenhouseEvents } from './thermal';
import { crossingEvents,energyEvents } from './routes';
export default defineModule<RpgServer>({player,maps:[{id:'greenhouse',events:greenhouseEvents},{id:'crossing',events:crossingEvents},{id:'crossing-east',events:crossingEvents},{id:'energy',events:energyEvents}]});
