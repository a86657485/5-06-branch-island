'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = path.join(__dirname, '../public/rules.js');
function rules() { assert.ok(fs.existsSync(source), '需要实现可供浏览器和服务端共同使用的分支规则'); return require(source); }
const sale = { operator: '<', yes: '5', no: '10' };
const repair = { operator: '>=', yes: '10', no: '5' };
const broken = { operator: '>=', yes: '5', no: '10' };
function run(id, config, input) { return { config, input, ...rules().evaluate(id, config, input) }; }
test('120厘米边界进入不优惠分支，两种等价表达都正确', () => {
  for (const config of [sale, repair]) for (const height of [119, 120, 121]) {
    const r = rules().evaluate('sale', config, { height });
    assert.equal(r.correct, true); assert.equal(r.output, height < 120 ? '5' : '10'); assert.ok(r.trace.length >= 3);
  }
  assert.equal(rules().evaluate('sale', sale, {height:120}).branch, 'no');
});
test('验证需要当前方案的三个边界测试和理由，旧方案记录不能充数', () => {
  const all = [119,120,121].map(height => run('sale',sale,{height}));
  assert.equal(rules().validateComplete('sale',sale,all,'boundary').passed,true);
  assert.equal(rules().validateComplete('sale',sale,all.slice(0,2),'boundary').passed,false);
  assert.equal(rules().validateComplete('sale',sale,all,'guess').passed,false);
  assert.equal(rules().validateComplete('sale',repair,all,'boundary').passed,false);
});
test('维修关必须先观察原错误方案在120厘米处的结果，再修订复验', () => {
  const all = [119,120,121].map(height => run('repair',repair,{height}));
  assert.equal(rules().validateComplete('repair',repair,all,'swap').passed,false);
  all.unshift(run('repair',broken,{height:120}));
  assert.equal(rules().validateComplete('repair',repair,all,'swap').passed,true);
  assert.equal(rules().evaluate('repair',broken,{height:120}).correct,false);
});
test('过街每次只执行一个分支，验证需两种设施状态', () => {
  const config={yes:'bridge',no:'crossing'};
  assert.equal(rules().evaluate('cross',config,{facility:true}).output,'bridge');
  assert.equal(rules().evaluate('cross',config,{facility:false}).output,'crossing');
  assert.equal(rules().validateComplete('cross',config,[run('cross',config,{facility:true})],'one').passed,false);
  assert.equal(rules().validateComplete('cross',config,[true,false].map(facility=>run('cross',config,{facility})),'one').passed,true);
});
test('最小值支持两种等价方案，必须测试a较小和b较小', () => {
  for(const config of [{operator:'<',yes:'a',no:'b'},{operator:'>',yes:'b',no:'a'}]) {
    const one=run('minimum',config,{a:3,b:8}); const other=run('minimum',config,{a:9,b:2});
    assert.equal(one.output,'3'); assert.equal(other.output,'2');
    assert.equal(rules().validateComplete('minimum',config,[one,other],'compare').passed,true);
    assert.equal(rules().validateComplete('minimum',config,[one,one],'compare').passed,false);
  }
});
test('拒绝与教材约束不符的输入和未知规则', () => {
  assert.throws(()=>rules().evaluate('minimum',{operator:'<',yes:'a',no:'b'},{a:3,b:3}));
  assert.throws(()=>rules().evaluate('sale',sale,{height:'120'}));
  assert.throws(()=>rules().evaluate('cross',{yes:'bridge',no:'crossing'},{facility:'false'}));
  assert.throws(()=>rules().evaluate('unknown',sale,{height:120}));
});
test('维修实验必须在看到原错误之后重新验证，事后补看不能替代复验', () => {
  const runs=[119,120,121].map(height=>run('repair',repair,{height}));
  runs.push(run('repair',broken,{height:120}));
  assert.equal(rules().validateComplete('repair',repair,runs,'swap').passed,false);
  runs.push(...[119,120,121].map(height=>run('repair',repair,{height})));
  assert.equal(rules().validateComplete('repair',repair,runs,'swap').passed,true);
});
test('方案修改后只接受本次修改之后的实验，维修诊断仍可回查历史', () => {
  const old=[119,120,121].map(height=>run('sale',sale,{height}));
  assert.equal(rules().validateComplete('sale',sale,old,'boundary',3).passed,false);
  const newRuns=[...old,...[119,120,121].map(height=>run('sale',sale,{height}))];
  assert.equal(rules().validateComplete('sale',sale,newRuns,'boundary',3).passed,true);
  const repaired=[run('repair',broken,{height:120}),...[119,120,121].map(height=>run('repair',repair,{height}))];
  assert.equal(rules().validateComplete('repair',repair,repaired,'swap',4).passed,false);
  repaired.push(...[119,120,121].map(height=>run('repair',repair,{height})));
  assert.equal(rules().validateComplete('repair',repair,repaired,'swap',4).passed,true);
});
const ventilation={model:'ventilation',operator:'>=',yes:'on',no:'off'};
const ventilationReverse={model:'ventilation',operator:'<',yes:'off',no:'on'};
const ventilationBroken={model:'ventilation',operator:'>=',yes:'off',no:'on'};
test('温室试运行模型在30度边界启动风机，两种判断方向等价',()=>{
  for(const config of [ventilation,ventilationReverse])for(const temperature of [29,30,31]){
    const result=rules().evaluate('sale',config,{temperature});
    assert.equal(result.correct,true);assert.equal(result.output,temperature>=30?'on':'off');assert.match(result.trace.join(' '),/温度|风机/);
  }
  assert.deepEqual(rules().normalizeConfig('sale',ventilation),ventilation);
  assert.notEqual(rules().configKey('sale',ventilation),rules().configKey('sale',sale));
  assert.throws(()=>rules().evaluate('sale',ventilation,{height:120}),/温度/);
  assert.throws(()=>rules().normalizeConfig('sale',{...ventilation,yes:'5'}),/分支/);
});
test('温室模型单独要求29、30、31测试，旧门票实验不能计入当前方案',()=>{
  const all=[29,30,31].map(temperature=>run('sale',ventilation,{temperature}));
  assert.equal(rules().validateComplete('sale',ventilation,all,'boundary').passed,true);
  assert.equal(rules().validateComplete('sale',ventilation,all.slice(0,2),'boundary').passed,false);
  assert.equal(rules().validateComplete('sale',ventilation,[...all.slice(0,2),run('sale',sale,{height:121})],'boundary').passed,false);
  assert.equal(rules().validateComplete('sale',ventilation,all,'boundary',3).passed,false);
});
test('温室维修先观察30度错误关机，修订后才复验；旧门票诊断不能充数',()=>{
  const all=[29,30,31].map(temperature=>run('repair',ventilation,{temperature}));
  assert.equal(rules().validateComplete('repair',ventilation,[run('repair',broken,{height:120}),...all],'swap').passed,false);
  const diagnosed=run('repair',ventilationBroken,{temperature:30});assert.equal(diagnosed.correct,false);
  assert.equal(rules().validateComplete('repair',ventilation,[...all,diagnosed],'swap').passed,false);
  assert.equal(rules().validateComplete('repair',ventilation,[diagnosed,...all],'swap').passed,true);
});
