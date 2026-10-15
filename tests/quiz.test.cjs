'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {questions,version}=require('../quiz.cjs');
test('20题保留独立检测并对应温室的新场景，选项位置均衡且选项不重复',()=>{
  assert.equal(questions.length,20);assert.equal(new Set(questions.map(q=>q.id)).size,20);
  for(const question of questions){assert.equal(question.options.length,4);assert.equal(new Set(question.options).size,4);assert.ok(Number.isInteger(question.answer)&&question.answer>=0&&question.answer<=3);assert.ok(question.explanation.length>10);}
  assert.deepEqual([0,1,2,3].map(index=>questions.filter(q=>q.answer===index).length),[5,5,5,5]);
  for(const question of questions.slice(3,13)){assert.match(question.prompt,/温度|温室|风机/);assert.doesNotMatch(question.prompt,/票价|身高/);}
  assert.match(questions[16].prompt,/电池|电量/);
});
test('新情境检测有明确版本，旧成绩可保留而不冒充同卷证据',()=>{
  assert.equal(version,'2026-10-14-park-v2');
});
