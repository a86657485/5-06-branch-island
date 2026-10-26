/** Pack the lesson's own generated art for RPGJS; no starter artwork is redistributed. */
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const tiled = path.join(root, 'engine/src/tiled');
const sprites = path.join(root, 'engine/public/spritesheets');
const W = 1536, H = 1024, TILE = 32, COLS = W / TILE, ROWS = H / TILE;
const crops = {
  engineer: [[115,10,160,328],[466,10,173,329],[815,10,172,328],[1184,11,159,328]],
  staff: [[126,343,136,369]], mechanic: [[450,349,211,369]],
  warden: [[807,343,225,372]], gardener: [[1161,347,207,366]], robot: [[1506,444,228,257]],
};
function svg(content, width = 72, height = 104) { return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`); }
const device = {
  'fan-off': '<ellipse cx="36" cy="95" rx="27" ry="7" fill="#0f172a" opacity=".15"/><path d="M25 67h22v25H25z" fill="#64748b"/><rect x="8" y="18" width="56" height="56" rx="9" fill="#94a3b8" stroke="#334155" stroke-width="3"/><circle cx="36" cy="46" r="23" fill="#e2e8f0" stroke="#475569" stroke-width="2"/><path d="M36 45c-22-24 17-31 7-8l-6 9c28-12 19 25 1 8l-4-7c-7 30-35 4-11-5z" fill="#64748b"/><circle cx="36" cy="46" r="5" fill="#334155"/><path d="M12 46h48M36 22v48" stroke="#334155" opacity=".5"/>',
  'fan-on': '<ellipse cx="36" cy="95" rx="27" ry="7" fill="#0f172a" opacity=".15"/><path d="M25 67h22v25H25z" fill="#0f766e"/><rect x="8" y="18" width="56" height="56" rx="9" fill="#5eead4" stroke="#115e59" stroke-width="3"/><circle cx="36" cy="46" r="23" fill="#ccfbf1" stroke="#0f766e" stroke-width="2"/><path d="M36 45c-22-24 17-31 7-8l-6 9c28-12 19 25 1 8l-4-7c-7 30-35 4-11-5z" fill="#14b8a6"/><circle cx="36" cy="46" r="5" fill="#115e59"/><path d="M3 28c-5 7-5 19 0 26M69 28c5 7 5 19 0 26M9 12c8-6 18-7 26-3" fill="none" stroke="#2dd4bf" stroke-width="3"/>',
  sensor: '<ellipse cx="36" cy="96" rx="24" ry="6" fill="#0f172a" opacity=".15"/><rect x="22" y="11" width="28" height="69" rx="13" fill="#f8fafc" stroke="#475569" stroke-width="3"/><path d="M36 25v41" stroke="#ef4444" stroke-width="8" stroke-linecap="round"/><circle cx="36" cy="68" r="10" fill="#ef4444"/><path d="M43 27h7M43 38h7M43 49h7" stroke="#475569" stroke-width="2"/><path d="M30 80h12v13H30z" fill="#64748b"/>',
  control: '<ellipse cx="36" cy="96" rx="29" ry="6" fill="#0f172a" opacity=".15"/><path d="M20 68h32v24H20z" fill="#475569"/><rect x="4" y="19" width="64" height="54" rx="8" fill="#334155" stroke="#cbd5e1" stroke-width="3"/><rect x="11" y="26" width="50" height="30" rx="3" fill="#bae6fd"/><path d="M22 41h10m-5-5 5 5-5 5m14-9v9m-4-4 4 4 4-4" stroke="#0369a1" fill="none" stroke-width="3"/><circle cx="18" cy="64" r="3" fill="#22c55e"/><rect x="29" y="61" width="26" height="6" rx="3" fill="#94a3b8"/>',
  monitor: '<ellipse cx="36" cy="96" rx="28" ry="6" fill="#0f172a" opacity=".15"/><path d="M30 64h12v25H30z" fill="#64748b"/><path d="M20 89h32v7H20z" fill="#475569"/><rect x="3" y="21" width="66" height="47" rx="7" fill="#334155" stroke="#94a3b8" stroke-width="3"/><rect x="10" y="28" width="52" height="31" rx="3" fill="#dcfce7"/><path d="m22 44 9 8 18-18" fill="none" stroke="#16a34a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
  'battery-a': '<ellipse cx="36" cy="96" rx="27" ry="6" fill="#0f172a" opacity=".15"/><rect x="25" y="12" width="22" height="8" rx="3" fill="#1e3a8a"/><rect x="13" y="20" width="46" height="72" rx="8" fill="#93c5fd" stroke="#1e40af" stroke-width="3"/><path d="m38 29-15 27h13l-3 26 17-33H37z" fill="#1d4ed8"/><path d="M17 86h38" stroke="#dbeafe" stroke-width="3"/>',
  'battery-b': '<ellipse cx="36" cy="96" rx="27" ry="6" fill="#0f172a" opacity=".15"/><rect x="25" y="12" width="22" height="8" rx="3" fill="#92400e"/><rect x="13" y="20" width="46" height="72" rx="8" fill="#fcd34d" stroke="#b45309" stroke-width="3"/><path d="m38 29-15 27h13l-3 26 17-33H37z" fill="#d97706"/><path d="M17 86h38" stroke="#fef3c7" stroke-width="3"/>',
  portal: '<ellipse cx="36" cy="96" rx="31" ry="7" fill="#0f172a" opacity=".15"/><path d="M11 93V24a25 25 0 0 1 50 0v69" fill="#bfdbfe" stroke="#0284c7" stroke-width="7"/><path d="M15 92V25a21 21 0 0 1 42 0v67" fill="#dbeafe"/><path d="M23 56h25m-10-10 10 10-10 10" fill="none" stroke="#0284c7" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
};
async function packCharacter(id, rows) {
  // 注意：character 图集对四个方向只提供了一张静态侧面/背面像，packCharacter 会把同一张图
  // 复制成 3 帧（只有中间帧上下错 2px），左右行走因此没有迈步。打包后必须再跑一次
  // `python scripts/build-walk-frames.py` 合成左右与背面的迈步帧，否则手感会“卡”。
  const fw = 72, fh = 104, layers = [];
  for (let row = 0; row < 4; row++) {
    const [left,top,width,height] = rows[row] || rows[0];
    const image = await sharp(path.join(root, 'public/assets/characters.png')).extract({left,top,width,height}).resize({width:60,height:94,fit:'inside'}).png().toBuffer();
    const meta = await sharp(image).metadata();
    for (let col = 0; col < 3; col++) {
      if (id === 'engineer' && row === 0 && col !== 1) {
        let walking = sharp(path.join(root, 'public/assets/characters.png')).extract({left:1892,top:356,width:190,height:355}).resize({width:60,height:94,fit:'inside'});
        if (col === 2) walking = walking.flop();
        const step = await walking.png().toBuffer();
        const size = await sharp(step).metadata();
        layers.push({input:step,left:col*fw+Math.floor((fw-size.width)/2),top:row*fh+fh-size.height-5});
      } else layers.push({input:image,left:col*fw+Math.floor((fw-meta.width)/2),top:row*fh+fh-meta.height-5-(col===1?0:2)});
    }
  }
  await sharp({create:{width:fw*3,height:fh*4,channels:4,background:'#00000000'}}).composite(layers).png().toFile(path.join(sprites,`${id}.png`));
}
async function packDevice(id, content) {
  const frame = await sharp(svg(content)).png().toBuffer();
  const layers = [];
  for (let row=0;row<4;row++) for(let col=0;col<3;col++) layers.push({input:frame,left:col*72,top:row*104});
  await sharp({create:{width:216,height:416,channels:4,background:'#00000000'}}).composite(layers).png().toFile(path.join(sprites,`${id}.png`));
}
function inside(x,y,p) { let yes=false; for(let i=0,j=p.length-1;i<p.length;j=i++){const[a,b]=p[i],[c,d]=p[j]; if(((b>y)!=(d>y))&&x<(c-a)*(y-b)/(d-b)+a)yes=!yes;}return yes; }
function ellipse(x,y,cx,cy,rx,ry){return((x-cx)/rx)**2+((y-cy)/ry)**2<=1;}
const parkPaths = [
 [[605,1024],[905,1024],[870,690],[855,575],[810,520],[685,520],[650,610],[630,800]],
 [[80,445],[245,395],[370,405],[545,455],[530,535],[420,565],[200,550],[80,520]],
 [[625,90],[780,130],[810,280],[1090,245],[1050,335],[885,350],[860,365],[650,350],[540,300],[395,250],[345,190],[535,185],[650,235],[700,275],[710,190],[625,125]],
 [[925,180],[1290,185],[1330,265],[1160,320],[1010,295],[925,260]],
 [[975,430],[1145,470],[1320,510],[1536,520],[1536,650],[1330,625],[1100,550],[1000,525]],
];
const stations = {
 greenhouse: {start:[780,620],guide:[520,430],sensor:[360,430],control:[260,500],fan:[420,520],verify:[600,500],portal:[700,530]},
 workshop: {start:[945,280],guide:[1035,245],sensor:[970,225],control:[1120,225],fan:[1245,225],verify:[1180,235],portal:[955,330]},
 energy: {start:[575,275],guide:[540,270],batteryA:[300,155],batteryB:[440,180],control:[365,190],monitor:[435,245],portal:[610,300]},
 crossing: {start:[350,810],guide:[350,600],observe:[430,515],control:[410,595],bridgeWest:[470,326],bridgeEast:[1080,326],crossingWest:[470,681],crossingEast:[1080,681],verify:[1135,535],portal:[1190,590]},
 'crossing-east': {start:[350,810],guide:[350,600],observe:[430,515],control:[410,595],bridgeWest:[470,326],bridgeEast:[1080,326],crossingWest:[470,681],crossingEast:[1080,681],verify:[1135,535],portal:[1190,590]},
};
function parkBlocked(x,y,mapId) {
  const taskSafety = Object.values(stations[mapId]).some(([sx,sy])=>ellipse(x,y,sx,sy,48,44));
  const path = parkPaths.some(p=>inside(x,y,p)) || ellipse(x,y,770,420,280,170) || ellipse(x,y,380,170,185,88);
  const flower = ellipse(x,y,770,416,119,64);
  const hut = inside(x,y,[[90,365],[205,325],[250,370],[245,480],[90,480]]);
  const shop = x>980&&x<1290&&y>32&&y<210;
  return !(path||taskSafety)||flower||hut||shop;
}
function roadBlocked(x,y,mapId) {
  if(x>=512&&x<1024) return !((y>=608&&y<768)||(mapId==='crossing-east'&&y>=288&&y<416));
  if(x<192||x>=1344) return true;
  if(x<320&&y<320) return true;
  if(x>=1216&&y>=352&&y<512) return true;
  if(x<320&&y>=512&&y<672) return true;
  if(x>=1216&&y>=640) return true;
  return false;
}
function blockedCells(mapId) {
  return Array.from({length:ROWS},(_,y)=>Array.from({length:COLS},(_,x)=>{
    const border=x===0||y===0||x===COLS-1||y===ROWS-1;
    return border||(mapId.startsWith('crossing')?roadBlocked(x*TILE+16,y*TILE+16,mapId):parkBlocked(x*TILE+16,y*TILE+16,mapId))?1:0;
  }));
}
function mapXml(mapId,cells) {
  const crossing=mapId.startsWith('crossing');
  const scenery = Array.from({length:ROWS},(_,y)=>Array.from({length:COLS},(_,x)=>y*COLS+x+1));
  const bridge = scenery.map(row=>row.map(gid=>gid+1537));
  const csv = rows=>rows.map(row=>row.join(',')).join(',\n');
  const names=Object.entries(stations[mapId]);
  const objects=names.map(([name,[x,y]],i)=>`  <object id="${i+1}" name="${name}"${name==='start'?' class="start"':''} x="${x}" y="${y}"><point/></object>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.11.2" orientation="orthogonal" renderorder="right-down" width="48" height="32" tilewidth="32" tileheight="32" infinite="0" nextlayerid="5" nextobjectid="${names.length+1}">
 <tileset firstgid="1" source="${crossing?'scene-crossing':'scene-park'}.tsx"/>
 <tileset firstgid="1537" source="collision.tsx"/>
 ${mapId==='crossing-east'?'<tileset firstgid="1538" source="scene-overpass.tsx"/>':''}
 <layer id="1" name="Lesson scenery" width="48" height="32">
  <properties><property name="z" type="float" value="0"/></properties>
  <data encoding="csv">\n${csv(scenery)}\n</data>
 </layer>
 ${mapId==='crossing-east'?'<layer id="4" name="Overpass" width="48" height="32"><properties><property name="z" type="float" value="0.1"/></properties><data encoding="csv">\n'+csv(bridge)+'\n</data></layer>':''}
 <layer id="2" name="Solid scenery" width="48" height="32"><properties><property name="z" type="float" value="0"/></properties><data encoding="csv">\n${csv(cells.map(row=>row.map(n=>n?1537:0)))}\n</data></layer>
 <objectgroup id="3" name="Lesson events"><properties><property name="z" type="float" value="1"/></properties>\n${objects}\n </objectgroup>
</map>\n`;
}
async function main(){
  await fs.mkdir(path.join(tiled,'images'),{recursive:true});
  await fs.mkdir(sprites,{recursive:true});
  // These came only from the newly imported starter, never from a user baseline.
  const starterFiles=['[A]WaterFall_pipo.tsx','[Base]BaseChip_pipo.png','[A]WaterFall_pipo.png','[Base]BaseChip_pipo.tsx','base.png','[A]Water_pipo.png','[A]Water_pipo.tsx','[Base]BaseChip_pipo3.png','[A]Dirt_pipo.png','[A]Flower_pipo.tsx','[A]Grass_pipo.tsx','[A]Wall-Up_pipo.png','[A]Flower_pipo.png','[A]Dirt_pipo.tsx','[A]Wall-Up_pipo.tsx','[A]Grass_pipo.png','map.tmx','simplemap.tmx','tileset.tsx'];
  for(const file of starterFiles) await fs.rm(path.join(tiled,file),{force:true});
  for(const file of ['hero.png','female.png']) await fs.rm(path.join(sprites,file),{force:true});
  const v2Dir=path.join(root,'scripts/assets/spritesheets_v2');
  for(const [id,rows]of Object.entries(crops)){
    const v2=path.join(v2Dir,`${id}.png`);
    try{await fs.copyFile(v2,path.join(sprites,`${id}.png`));}catch{await packCharacter(id,rows);}
  }
  for(const extra of ['engineer-girl','engineer-mecha-boy','engineer-mecha-girl','engineer-explorer-boy','engineer-explorer-girl']){
    try{await fs.copyFile(path.join(v2Dir,`${extra}.png`),path.join(sprites,`${extra}.png`));}catch{}
  }
  for(const[id,content]of Object.entries(device)){
    const v2=path.join(v2Dir,`${id}.png`);
    try{await fs.copyFile(v2,path.join(sprites,`${id}.png`));}catch{await packDevice(id,content);}
  }
  for(const name of ['park-map','crossing-map'])await fs.copyFile(path.join(root,`public/assets/${name}.webp`),path.join(tiled,`images/${name}.webp`));
  await sharp({create:{width:32,height:32,channels:4,background:'#00000000'}}).png().toFile(path.join(tiled,'images/collision.png'));
  await fs.writeFile(path.join(tiled,'collision.tsx'),'<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" tiledversion="1.11.2" name="Lesson collision" tilewidth="32" tileheight="32" tilecount="1" columns="1"><image source="images/collision.png" width="32" height="32"/><tile id="0"><properties><property name="collision" type="bool" value="true"/></properties></tile></tileset>\n');
  for(const [name,file] of [['park','park-map.webp'],['crossing','crossing-map.webp'],['overpass','overpass.png']]) await fs.writeFile(path.join(tiled,`scene-${name}.tsx`),`<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" tiledversion="1.11.2" name="Lesson ${name}" tilewidth="32" tileheight="32" tilecount="1536" columns="48"><image source="images/${file}" width="1536" height="1024"/></tileset>\n`);
  const bridge = '<ellipse cx="770" cy="402" rx="300" ry="28" fill="#0f172a" opacity=".3"/><path d="M465 345Q768 255 1085 345V403Q768 328 465 403Z" fill="#b5753c" stroke="#6f462b" stroke-width="6"/><path d="M480 344Q768 272 1070 344V385Q768 319 480 385Z" fill="#e4ba77"/>'+Array.from({length:26},(_,i)=>`<path d="M${480+i*23} ${i<13?344-i*2.1:317+(i-13)*2.1}v42" stroke="#b9864d" stroke-width="2"/>`).join('')+'<path d="M464 340Q768 250 1088 340M464 394Q768 315 1088 394" fill="none" stroke="#704629" stroke-width="8"/>'+Array.from({length:9},(_,i)=>`<path d="M${465+i*78} ${340-Math.sin(i/8*Math.PI)*46}v-30M${465+i*78} ${394-Math.sin(i/8*Math.PI)*40}v-30" stroke="#805331" stroke-width="7"/>`).join('')+'<path d="M464 311Q768 218 1088 311M464 365Q768 285 1088 365" fill="none" stroke="#cc9d5a" stroke-width="7"/>';
  await sharp(svg(bridge,W,H)).png().toFile(path.join(tiled,'images/overpass.png'));
  const layouts={};
  for(const mapId of Object.keys(stations)){
    const cells=blockedCells(mapId); layouts[mapId]={width:W,height:H,tileSize:TILE,positions:stations[mapId],blockedTiles:cells.flat().reduce((a,b)=>a+b,0)};
    await fs.writeFile(path.join(tiled,`${mapId}.tmx`),mapXml(mapId,cells));
  }
  await fs.writeFile(path.join(tiled,'layout.json'),JSON.stringify(layouts,null,2)+'\n');
  console.log(`Packed ${Object.keys(crops).length} characters, ${Object.keys(device).length} devices, ${Object.keys(stations).length} Tiled maps from lesson-owned artwork.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
