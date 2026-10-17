import { defineModule } from '@rpgjs/common';
import type { RpgServer } from '@rpgjs/server';
import { player } from './player';
import { greenhouseEvents,workshopEvents } from './thermal';
import { crossingEvents,energyEvents } from './routes';
export default defineModule<RpgServer>({player,maps:[{id:'greenhouse',events:greenhouseEvents},{id:'workshop',events:workshopEvents},{id:'crossing',events:crossingEvents},{id:'crossing-east',events:crossingEvents},{id:'energy',events:energyEvents}]});
