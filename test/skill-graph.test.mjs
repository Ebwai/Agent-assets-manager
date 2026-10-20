import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileGraph,normalizeGraph,createGraph,graphWarnings,needsGraphSync,autoLayout} from '../public/skill-graph.js';
import {graphModelRequest,parseGraphModelResult,defaultVisualizeSystem,defaultSyncGraphSystem} from '../skill-visualization.mjs';
import {assetFiles} from '../version-diff.mjs';

function example(){return normalizeGraph({nodes:[
  {id:'in',type:'input',title:'需求输入'},
  {id:'choose',type:'decision',title:'选择路径',condition:'是否有资料'},
  {id:'fork',type:'parallel',title:'并行处理',parallelMode:'allowed',failure:'保留部分结果并报告失败'},
  {id:'read',type:'step',title:'阅读资料',input:'已有资料',output:'摘要',verification:'保留出处'},
  {id:'check',type:'verify',title:'检查边界'},
  {id:'join',type:'join',title:'汇合',joinMode:'all'},
  {id:'loop',type:'loop',title:'返工',exitCondition:'验证通过',limit:'最多三次'},
  {id:'wait',type:'wait',title:'用户确认',text:'只有用户明确要求确认时等待'},
  {id:'out',type:'output',title:'交付',text:'最终报告'},
  {id:'region',type:'group',title:'准备阶段'},
  {id:'sub',type:'subflow',title:'调用准备阶段',targets:['region']},
  {id:'kp',type:'keypoint',title:'保留出处',text:'记录原始链接',scope:'node',targets:['read']},
  {id:'rule',type:'boundary',title:'不得虚构',text:'禁止伪造事实',scope:'edge',targets:['conditional']},
  {id:'global',type:'boundary',title:'全局规则',text:'必须保留用户明确要求',scope:'global'},
  {id:'scoped',type:'boundary',title:'区域约束',text:'禁止修改源文件',scope:'group',targets:['region']},
  {id:'res',type:'resource',title:'参考说明',resource:'references/guide.md',scope:'node',targets:['read']},
  {id:'note',type:'note',title:'私人便签',text:'这个想法还没定'}
],edges:[
  {id:'e1',source:'in',target:'choose'},
  {id:'conditional',source:'choose',target:'fork',label:'有资料'},
  {id:'otherwise',source:'choose',target:'wait',label:'否则'},
  {id:'e3',source:'fork',target:'read'},{id:'e4',source:'fork',target:'check'},
  {id:'e5',source:'read',target:'join'},{id:'e6',source:'check',target:'join'},
  {id:'e7',source:'join',target:'loop'},{id:'e8',source:'loop',target:'read',label:'验证失败'},
  {id:'e9',source:'loop',target:'out',label:'验证通过'}
],sections:[{title:'Purpose / Overview',content:'这是完整说明。',suggestion:'可以更简洁。'},{title:'示例',content:'```text\n输入例子\n```'}]});}

test('图生成保留分支、并行、循环、等待和规则范围，不包含作者便签或修改建议',()=>{
  const g=example();g.nodes.find(n=>n.id==='read').groupId='region';const result=compileGraph(g);
  for(const text of ['输入信息不全仅作提醒','当“有资料”时','任务相互独立，允许并行执行','全部分支完成后继续','保留部分结果并报告失败','退出条件：验证通过','最多三次','当“验证失败”时','用户确认','区域约束','路径 S2','记录原始链接','references/guide.md','引用子流程：准备阶段','这是完整说明。','输入例子'])assert.ok(result.includes(text),text);
  assert.ok(!result.includes('私人便签'));assert.ok(!result.includes('可以更简洁。'));
});

test('移动、缩放布局及移除提示不改变正文；循环布局不会无限展开',()=>{
  const g=example(),original=compileGraph(g);
  for(const n of g.nodes){n.x+=700;n.y+=300;}
  g.dismissedWarnings=['join:join'];assert.equal(compileGraph(g),original);
  assert.equal(compileGraph(autoLayout(g)),original);
  assert.equal(compileGraph(normalizeGraph(JSON.parse(JSON.stringify(g)))),original);
});

test('空信息、断线和未完整条件仅提醒且可删除提示',()=>{
  const g=normalizeGraph({nodes:[{id:'d',type:'decision'},{id:'j',type:'join'},{id:'l',type:'loop'},{id:'r',type:'resource',resource:'references/missing.md',scope:'node'}],edges:[{id:'broken',source:'d',target:'missing'}]});
  const body=compileGraph(g);assert.ok(body.includes('由 Agent'));
  const warnings=graphWarnings(g);assert.ok(warnings.length>=6);
  g.dismissedWarnings=warnings.map(w=>w.id);assert.ok(graphWarnings(g).every(w=>w.dismissed));
  assert.equal(compileGraph(g),body);assert.equal(needsGraphSync({graph:g,body}),false);
  assert.equal(needsGraphSync({graph:g,body:body+'新规则'}),true);
  assert.equal(needsGraphSync({body:'旧 Skill'}),false);
});

test('创建画板保留原正文，结构损坏与超过容量明确报错',()=>{
  const text='## 目的\n保留原文\n\n```js\nconsole.log(1)\n```';assert.ok(compileGraph(createGraph(text)).includes(text));
  assert.throws(()=>normalizeGraph({}),/节点和连线/);
  assert.throws(()=>normalizeGraph({nodes:[{id:'x'},{id:'x'}],edges:[]}),/重复/);
  assert.throws(()=>normalizeGraph({nodes:Array.from({length:301},()=>({})),edges:[]}),/300/);
});

test('AI 请求自动选择章节，增量同步携带现有图、旧正文、编辑正文和变化',()=>{
  const graph=example(),old=compileGraph(graph),edited=old.replace('不得虚构','不得捏造');
  const req=JSON.parse(graphModelRequest({graph,body:edited,frontmatter:{name:'test'}},{'references/guide.md':'secret-content'},'sync'));
  assert.equal(req.previousBody,old);assert.equal(req.editedBody,edited);assert.equal(req.existingGraph.nodes.length,graph.nodes.length);
  assert.equal(req.changes.before,'虚构');assert.equal(req.changes.after,'捏造');assert.ok(!JSON.stringify(req).includes('secret-content'));
  assert.match(defaultVisualizeSystem,/自动选择/);assert.match(defaultSyncGraphSystem,/未受影响/);
  const parsed=parseGraphModelResult('```json\n'+JSON.stringify({graph,summary:'完成'})+'\n```');assert.equal(parsed.body,old);
  assert.throws(()=>parseGraphModelResult('解释文字'),/无法解析/);
  assert.throws(()=>parseGraphModelResult('{"nodes":[],"edges":[]}'),/未返回/);
});

test('历史差异包含每个模板和配置中的画板源数据',()=>{
  const graph=example(),v={graph,body:compileGraph(graph),frontmatter:{name:'test'}};
  const files=assetFiles({variants:{common:v,claude:v},profiles:{'codex:test':{variants:{common:v}}}},'skill');
  assert.ok(files['画板.json']);assert.ok(files['variants/claude/画板.json']);assert.ok(files['profiles/codex:test/画板.json']);
});
