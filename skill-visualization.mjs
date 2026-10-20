import { normalizeGraph, compileGraph, nodeTypes } from './public/skill-graph.js';

const schema = `只返回一个 JSON 对象，不要 Markdown 围栏。结构：{"graph":{"version":1,"title":"流程名称","nodes":[],"edges":[],"sections":[]},"summary":"处理摘要"}。
nodes 每项：{id,type,title,text,input,output,verification,failure,condition,exitCondition,limit,resource,groupId,parallelMode,joinMode,severity,scope,targets,x,y}。除 id,type 外其他字段可省略。type 为 ${Object.keys(nodeTypes).join(', ')}。所有正文内容字段是字符串。x,y 为数字。parallelMode 为 allowed/required 或空，joinMode 为 all/any 或空。scope 为 global/node/edge/group，targets 是节点或连线 id 的数组。groupId 表示所属 group 节点。子流程 subflow 的 targets 引用 group 或流程入口。
edges 每项：{id,source,target,label,kind}；kind 为 flow 或 attachment。执行连接用 flow，规则／资源与步骤关联用 attachment；规则也可以通过 scope+targets 关联到连线或区域。判断分支条件填写在 label，汇合方式写在 join 节点。循环用 loop 及回边，保留退出条件和失败处理。不要根据节点坐标表达执行顺序。
sections 每项：{id,title,content,suggestion}，用于原文不适合可视化的内容。title 应优先匹配原 Skill 或 Purpose / Overview、Input、Output、Key Points、Edge cases、Tools / resources、Verification 等合适章节；无法归类时放补充说明。content 忠实保留原文；suggestion 提供这部分的修改建议，不进入最终 Agent 文档。
自动选择适合可视化的章节，用户不需要选择。保持原文条件、否定、规则范围、示例、代码和资源引用；禁止静默遗漏。知识、模板、背景和长示例保留为 sections，不要强行变成步骤。不输出来源追踪、AI 推断标记或待确认字段。允许信息留空，由 Agent 结合上下文判断；不要把缺失信息自行改成强制等待确认。用户明确要求等待／确认的原文应保留。`;

export const defaultVisualizeSystem = `你是 Skill 文档可视化编排助手。将整篇当前 Skill 自动整理为可编辑的语义画板，并保留全部不适合画图的文字和修改建议。${schema}`;
export const defaultSyncGraphSystem = `你是 Skill 画板增量同步助手。根据现有图、图生成的旧正文、用户编辑后的正文及修改内容，更新现有画板。未受影响的节点 id、连线 id 和位置尽量保持；删除不再适用的内容，新增或修改受影响的步骤、条件、规则和保留章节。用户编辑后的文字是本次修改意图；不得简单返回未修改的旧图。${schema}`;

export function graphModelRequest(variant,files={},mode='visualize') {
  if(!variant || typeof variant.body!=='string')throw Error('请提供当前 Skill 正文');
  if(mode==='sync'&&!variant.graph)throw Error('当前 Skill 尚无可同步的画板');
  const oldBody=variant.graph?compileGraph(variant.graph):'';
  // Common prefix/suffix makes the modified region explicit without altering the source text.
  let start=0,end=0;
  while(start<oldBody.length&&start<variant.body.length&&oldBody[start]===variant.body[start])start++;
  while(end<oldBody.length-start&&end<variant.body.length-start&&oldBody.at(-end-1)===variant.body.at(-end-1))end++;
  return JSON.stringify({operation:mode,frontmatter:variant.frontmatter||{},resources:Object.keys(files),existingGraph:variant.graph||null,previousBody:oldBody,editedBody:variant.body,changes:{before:oldBody.slice(start,oldBody.length-end),after:variant.body.slice(start,variant.body.length-end)}},null,2);
}

export function parseGraphModelResult(text) {
  let parsed;
  try { parsed=JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g,'')); }
  catch {throw Error('模型返回的画板无法解析，请重试或调整可视化提示词；当前草稿已保留');}
  const graph=normalizeGraph(parsed.graph||parsed);
  if(!graph.nodes.length&&!graph.sections.some(s=>s.content.trim()))throw Error('模型未返回步骤或保留内容，当前草稿已保留');
  return {graph,body:compileGraph(graph),summary:typeof parsed.summary==='string'?parsed.summary:'已生成可编辑画板'};
}
