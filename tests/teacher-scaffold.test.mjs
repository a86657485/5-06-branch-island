import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import adventure from '../public/adventure-rules.js';
import { pointsLabel } from '../public/scoreboard.mjs';

function evidenceRows(support) {
 const context=vm.createContext({window:{AdventureRules:adventure},pointsLabel,Date});
 const source=fs.readFileSync(new URL('../public/teacher.mjs',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'')
  .replace(/load\(\);setInterval\(load,5000\);\s*$/,'');
 vm.runInContext(`${source}\nglobalThis.evidenceRows=state=>{data={};expanded='student-a';return rows([{id:'student-a',name:'同学甲',entered:true,state}]);};`,context);
 return context.evidenceRows({drafts:{},levels:{},runs:{},predictions:{},attempts:[],points:0,support});
}

test('教师证据逐站统计免费帮助次数与最高级别，排除重置且与法宝分开',()=>{
 const html=evidenceRows({hints:[{levelId:'sale',action:'查看方案',why:'检查条件'}],scaffolds:[
  {levelId:'sale',level:1,count:1,lines:['观察一次'],at:'2026-10-26T01:00:00.000Z',conceptual:false},
  {levelId:'sale',level:2,count:2,lines:['比较条件'],at:'2026-10-26T01:01:00.000Z',conceptual:true},
  {levelId:'sale',level:3,count:99,lines:['检查出口'],at:'2026-10-26T01:02:00.000Z',conceptual:true},
  {levelId:'sale',level:0,count:0,lines:['重置事件不展示'],at:'2026-10-26T01:03:00.000Z',conceptual:false},
  {levelId:'repair',level:1,count:1,lines:['观察返修'],at:'2026-10-26T01:04:00.000Z',conceptual:false}
 ]});
 assert.match(html,/通关法宝：本课已用 1\/5 次/);
 assert.match(html,/免费递进帮助另行记录，不占全课5次法宝/);
 assert.match(html,/第1级为观察提醒，第2、3级为概念帮助/);
 assert.match(html,/温室风机调试[\s\S]*?免费递进帮助：3次；最高级别：第3级/);
 assert.match(html,/温室控制器返修[\s\S]*?免费递进帮助：1次；最高级别：第1级/);
 assert.match(html,/路口导行屏调试[\s\S]*?免费递进帮助：0次；最高级别：尚无/);
 assert.match(html,/储能柜配电[\s\S]*?免费递进帮助：0次；最高级别：尚无/);
 assert.match(html,/<details><summary>本站免费递进帮助 3 次<\/summary>/);
 assert.doesNotMatch(html,/重置事件不展示|第0级/);
});

test('教师可展开帮助内容与时间，观察和概念帮助分别标注并转义文本',()=>{
 const at='2026-10-26T02:03:04.000Z';
 const html=evidenceRows({hints:[],scaffolds:[
  {levelId:'sale',level:1,lines:['先看风机'],at,conceptual:false},
  {levelId:'sale',level:2,lines:['先看 <条件>','再看 & 出口'],at,conceptual:true},
  {levelId:'sale',level:3,lines:['检查对应动作'],at,conceptual:true}
 ]});
 assert.match(html,/第1级 · 观察提醒/);
 assert.match(html,/第2级 · 概念帮助/);
 assert.match(html,/第3级 · 概念帮助/);
 assert.match(html,/<p>先看 &lt;条件&gt;<\/p><p>再看 &amp; 出口<\/p>/);
 assert.ok(html.includes(new Date(at).toLocaleString('zh-CN')));
});

test('旧学生记录没有递进帮助时仍能展开证据',()=>{
 const html=evidenceRows(undefined);
 assert.equal((html.match(/免费递进帮助：0次；最高级别：尚无/g)||[]).length,4);
 assert.doesNotMatch(html,/<summary>本站免费递进帮助/);
 assert.match(html,/通关法宝：本课已用 0\/5 次/);
});
