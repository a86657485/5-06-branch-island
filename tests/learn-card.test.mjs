import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STORIES,ROUTE,storyChangesLearning} from '../public/patrol.mjs';
const cards=await import('../public/learn-card.mjs').catch(()=>({}));

test('四站先学卡给出教材来源与短讲，不替学生填本站方案',()=>{
 assert.equal(typeof cards.learnCard,'function','先学卡尚未实现');
 for(const id of ['sale','repair','cross','minimum']){
  const card=cards.learnCard(id);
  assert.ok(card.title && card.purpose && card.image.alt);
  assert.equal(card.duration,'约30—45秒');
  assert.ok(card.lines.length>=3 && card.lines.length<=4);
  for(const text of [card.title,card.purpose,...card.lines])assert.ok([...text].length<=25,text);
  assert.match(card.image.src,/^\/assets\/textbook\/.+\.png$/);
  assert.ok(fs.existsSync(new URL('../public'+card.image.src,import.meta.url)));
  assert.match(card.image.page,/教材第3[7-9]页/);
  assert.match(card.image.source.file,/第6课.*\.pdf$/);
  assert.ok(card.image.source.splitPage>=3 && card.image.source.splitPage<=5);
  assert.equal(card.image.source.crop.length,4);
  assert.doesNotMatch(card.lines.join(''),/29.*关闭|30.*启动|31.*启动|是.*启动.*否.*关闭|a＜b.*是.*A/);
 }
 assert.throws(()=>cards.learnCard('quiz'),/探究|站点/);
});

test('教材图是学生区局部，过街图不包含完整出口动作',()=>{
 assert.equal(typeof cards.learnCard,'function','先学卡尚未实现');
 const road=cards.learnCard('cross').image;
 assert.match(road.source.description,/不含.*出口动作/);
 for(const id of ['sale','repair','cross','minimum']){
  const image=cards.learnCard(id).image;
  assert.ok(image.source.crop[2]<430,'不应裁入右侧教参栏');
  assert.match(image.source.description,/学生/);
 }
});

test('站内剧情每次不超过两句，每句不超过25字，路线和学习判定不变',()=>{
 for(const id of ['sale','repair','cross','minimum'])for(const beat of Object.values(STORIES[id])){
  assert.ok(beat.lines.length<=2,`${id}对白过多`);
  for(const text of beat.lines)for(const sentence of text.split(/[。！？]/).filter(Boolean))assert.ok([...sentence].length<=25,`${id}: ${text}`);
 }
 assert.deepEqual(ROUTE,['sale','repair','cross']);
 assert.equal(storyChangesLearning(),false);
});
