import { Presets } from '@rpgjs/client';

// Four directional rows follow RPGJS's down / left / right / up convention.
// Artwork is packed from this lesson's generated atlas, not starter game assets.
export const PLAYER_SKINS = [
  'engineer',
  'engineer-girl',
  'engineer-mecha-boy',
  'engineer-mecha-girl',
  'engineer-explorer-boy',
  'engineer-explorer-girl',
] as const;

const ids = [
  ...PLAYER_SKINS,
  'staff', 'mechanic', 'warden', 'gardener', 'robot',
  'fan-on', 'fan-off', 'sensor', 'control', 'monitor',
  'battery-a', 'battery-b', 'portal',
];

export const lessonSprites = ids.map((id) => ({
  id,
  image: `${import.meta.env.BASE_URL}spritesheets/${id}.png`,
  ...Presets.RMSpritesheet(3, 4),
}));
