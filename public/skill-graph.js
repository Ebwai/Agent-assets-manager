// Shared by browser and server: graph semantics must never depend on layout or a model.
export const nodeTypes = Object.freeze({ input:'输入', step:'步骤', decision:'判断', parallel:'并行分支', join:'汇合', wait:'等待／确认', loop:'重复／返工', verify:'验证', subflow:'子流程', output:'输出', group:'流程区域', keypoint:'Key Point', boundary:'边界条件', resource:'资源引用', note:'作者便签' });
export const annotationTypes = new Set(['keypoint','boundary','resource','note']);
const textFields = ['title','text','input','output','verification','failure','condition','exitCondition','limit','resource','groupId','parallelMode','joinMode','severity'];
const str = value => typeof value === 'string' ? value : '';
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function normalizeGraph(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw Error('画板需要节点和连线列表');
  if (value.nodes.length > 300 || value.edges.length > 1000 || (value.sections?.length || 0) > 100) throw Error('画板最多包含 300 个节点、1000 条连线及 100 个文字章节');
  if (JSON.stringify(value).length > 2_000_000) throw Error('画板内容超过 2 MB，请拆分内容');
  const ids = new Set();
  const nodes = value.nodes.map((node, index) => {
    if (!node || typeof node !== 'object') throw Error('画板节点格式无效');
    const id = str(node.id) || `node-${index + 1}`;
    if (ids.has(id)) throw Error('画板节点标识重复，请重新生成');
    ids.add(id);
    return { id, type: Object.hasOwn(nodeTypes,node.type) ? node.type : 'step', ...Object.fromEntries(textFields.map(key => [key,str(node[key])])), scope:['global','node','edge','group'].includes(node.scope)?node.scope:'global', targets:Array.isArray(node.targets)?node.targets.filter(v=>typeof v==='string'):[], x:finite(node.x,80+(index%3)*300), y:finite(node.y,70+Math.floor(index/3)*170) };
  });
  const edgeIds = new Set();
  const edges = value.edges.map((edge,index) => {
    if (!edge || typeof edge !== 'object') throw Error('画板连线格式无效');
    const id=str(edge.id)||`edge-${index+1}`;
    if(edgeIds.has(id)) throw Error('画板连线标识重复');
    edgeIds.add(id);
    return {id,source:str(edge.source),target:str(edge.target),label:str(edge.label),kind:edge.kind==='attachment'?'attachment':'flow'};
  });
  if(value.sections!==undefined&&!Array.isArray(value.sections))throw Error('保留文字章节格式无效');
  const sections=(value.sections||[]).map((section,index)=>({id:str(section?.id)||`section-${index+1}`,title:str(section?.title)||'补充说明',content:str(section?.content),suggestion:str(section?.suggestion)}));
  return {version:1,title:str(value.title),nodes,edges,sections,dismissedWarnings:Array.isArray(value.dismissedWarnings)?value.dismissedWarnings.filter(v=>typeof v==='string').slice(0,2000):[]};
}

export function createGraph(body='') {
  return normalizeGraph({title:'Skill 工作流',nodes:[],edges:[],sections:body.trim()?[{id:'original',title:'原有正文',content:body,suggestion:'可使用 AI 自动将适合的部分整理为画板。'}]:[]});
}

export function graphWarnings(value, files={}) {
  const graph=normalizeGraph(value), result=[];
  const add=(id,message,nodeId)=>result.push({id,message,nodeId,dismissed:graph.dismissedWarnings.includes(id)});
  const flows=graph.edges.filter(e=>e.kind==='flow'), byId=new Map(graph.nodes.map(n=>[n.id,n]));
  for(const edge of graph.edges)if(!byId.has(edge.source)||!byId.has(edge.target))add(`edge:${edge.id}`,'连线有一端没有对应节点，可重新连接或删除。',edge.source);
  for(const node of graph.nodes){
    const out=flows.filter(e=>e.source===node.id);
    if(!node.title.trim()&&node.type!=='note')add(`title:${node.id}`,'卡片尚未命名，可由 Agent 结合内容理解。',node.id);
    if(node.type==='input'&&!node.text.trim()&&!node.input.trim())add(`input:${node.id}`,'输入未填写，可由 Agent 根据上下文判断。',node.id);
    if(node.type==='decision'&&(!out.length||out.some(e=>!e.label.trim())))add(`condition:${node.id}`,'判断分支有未填写的条件，可补充或交给 Agent 判断。',node.id);
    if(node.type==='decision'&&!out.some(e=>/其他|否则|默认|else|default/i.test(e.label)))add(`default:${node.id}`,'判断尚未标注默认分支。',node.id);
    if(node.type==='parallel'&&out.length<2)add(`parallel:${node.id}`,'并行分支少于两条。',node.id);
    if(node.type==='join'&&!node.joinMode)add(`join:${node.id}`,'汇合规则未填写，可由 Agent 结合上下文判断。',node.id);
    if(node.type==='loop'&&!node.exitCondition.trim())add(`loop:${node.id}`,'重复流程尚未填写退出条件。',node.id);
    if(!annotationTypes.has(node.type)&&node.type!=='group'&&!flows.some(e=>e.source===node.id||e.target===node.id))add(`isolated:${node.id}`,'这个节点尚未连接到其他步骤。',node.id);
    if(annotationTypes.has(node.type)&&node.type!=='note'&&node.scope!=='global'&&!node.targets.length&&!graph.edges.some(e=>e.kind==='attachment'&&(e.source===node.id||e.target===node.id)))add(`scope:${node.id}`,'规则尚未关联对象，仍会保留为未指定范围的说明。',node.id);
    for(const target of node.targets)if(!(node.scope==='edge'?graph.edges.some(e=>e.id===target):byId.has(target)))add(`target:${node.id}:${target}`,'关联对象已不存在，规则文字仍会保留。',node.id);
    if(node.resource&&!/^(https?:\/\/|#)/.test(node.resource)&&!Object.hasOwn(files,node.resource))add(`resource:${node.id}`,'引用的资源未在当前 Skill 资源列表中找到。',node.id);
    if(node.groupId&&!byId.has(node.groupId))add(`group:${node.id}`,'所属流程区域已不存在。',node.id);
  }
  const boundaries=graph.nodes.filter(n=>n.type==='boundary');
  for(let i=0;i<boundaries.length;i++)for(let j=i+1;j<boundaries.length;j++){
    const a=boundaries[i],b=boundaries[j],ma=a.text.trim().match(/^(必须|禁止)(.+)$/),mb=b.text.trim().match(/^(必须|禁止)(.+)$/);
    if(ma&&mb&&ma[1]!==mb[1]&&ma[2]===mb[2]&&a.scope===b.scope&&JSON.stringify(a.targets)===JSON.stringify(b.targets))add(`conflict:${a.id}:${b.id}`,'相同范围存在相反的“必须／禁止”说明，请自行检查。',a.id);
  }
  return result;
}

export function compileGraph(value) {
  const graph=normalizeGraph(value), nodes=graph.nodes.filter(n=>!annotationTypes.has(n.type)&&n.type!=='group');
  const refs=new Map(nodes.map((n,i)=>[n.id,`S${i+1}`]));
  const byId=new Map(graph.nodes.map(n=>[n.id,n]));
  const label=id=>refs.has(id)?`${refs.get(id)} ${byId.get(id).title||nodeTypes[byId.get(id).type]}`:byId.get(id)?.title||`未指定对象（${id}）`;
  const scope=node=>{
    if(node.scope==='global')return '整个 Skill';
    const targets=[...node.targets];
    for(const edge of graph.edges.filter(e=>e.kind==='attachment'&&(e.source===node.id||e.target===node.id)))targets.push(edge.source===node.id?edge.target:edge.source);
    if(!targets.length)return '范围未指定，由 Agent 结合上下文判断';
    return [...new Set(targets)].map(id=>{const edge=graph.edges.find(e=>e.id===id);return edge?`路径 ${label(edge.source)} → ${label(edge.target)}${edge.label?`（${edge.label}）`:''}`:label(id);}).join('；');
  };
  const out=['## Core workflow','','未填写的细节由 Agent 根据上下文判断；输入信息不全仅作提醒，除非下列步骤明确要求暂停。步骤编号用于引用，执行关系以连接说明为准。',''];
  if(!nodes.length)out.push('当前尚未定义执行步骤，可结合下列说明开展任务。','');
  for(const node of nodes){
    out.push(`### ${refs.get(node.id)} · ${node.title||nodeTypes[node.type]}（${nodeTypes[node.type]}）`,'');
    if(node.text)out.push(node.text,'');
    for(const [key,title] of [['input','输入／前置条件'],['output','输出／完成条件'],['condition','判断依据'],['verification','验证标准'],['failure','失败处理'],['exitCondition','退出条件'],['limit','重复上限'],['resource','工具／资源']])if(node[key])out.push(`- ${title}：${node[key]}`);
    if(node.groupId)out.push(`- 所属流程区域：${label(node.groupId)}`);
    if(node.type==='parallel')out.push(`- 并行方式：${node.parallelMode==='required'?'要求并行执行':node.parallelMode==='allowed'?'任务相互独立，允许并行执行':'由 Agent 根据任务和运行环境判断'}`);
    if(node.type==='join')out.push(`- 汇合规则：${node.joinMode==='all'?'全部分支完成后继续':node.joinMode==='any'?'任意一个分支完成即可继续':'由 Agent 根据上下文判断'}`);
    if(node.type==='wait')out.push('- 按本步骤明确填写的内容等待补充或确认；未指定等待要求时，由 Agent 根据上下文判断。');
    if(node.type==='subflow'&&node.targets.length)out.push(`- 引用子流程：${node.targets.map(label).join('；')}`);
    const outgoing=graph.edges.filter(e=>e.kind==='flow'&&e.source===node.id);
    for(const edge of outgoing)out.push(`- 后续：${edge.label?`当“${edge.label}”时，`:node.type==='decision'?'由 Agent 判断适用条件后，':''}进入 ${label(edge.target)}。`);
    if(outgoing.length===0&&node.type!=='output')out.push('- 后续连接未指定，由 Agent 根据上下文决定。');
    const local=graph.nodes.filter(n=>annotationTypes.has(n.type)&&n.type!=='note'&&n.scope!=='global'&&(n.targets.includes(node.id)||graph.edges.some(e=>e.kind==='attachment'&&((e.source===n.id&&e.target===node.id)||(e.target===n.id&&e.source===node.id)))));
    for(const rule of local)out.push(`- ${nodeTypes[rule.type]}${rule.severity?`（${rule.severity}）`:''}：${[rule.title,rule.text,rule.resource].filter(Boolean).join(' — ')}`);
    out.push('');
  }
  for(const type of ['input','output']){
    const items=nodes.filter(n=>n.type===type);
    if(items.length)out.push(`## ${type==='input'?'Input':'Output'}`,'',...items.map(n=>`- ${label(n.id)}：${n.text||n[type]||'由 Agent 结合上下文判断。'}`),'');
  }
  const groups=graph.nodes.filter(n=>n.type==='group');
  if(groups.length){out.push('## 流程区域与子流程','');for(const group of groups)out.push(`- ${group.title||'未命名区域'}：${group.text||''}${graph.nodes.some(n=>n.groupId===group.id)?`；包含 ${graph.nodes.filter(n=>n.groupId===group.id).map(n=>label(n.id)).join('、')}`:''}`);out.push('');}
  for(const [type,title] of [['keypoint','Key Points'],['boundary','Edge cases / 边界条件'],['resource','Tools / resources']]){
    const rules=graph.nodes.filter(n=>n.type===type);
    if(rules.length){out.push(`## ${title}`,'');for(const rule of rules)out.push(`- [${scope(rule)}] ${rule.severity?`${rule.severity}：`:''}${[rule.title,rule.text,rule.resource].filter(Boolean).join(' — ')||'具体内容由 Agent 结合上下文判断。'}`);out.push('');}
  }
  for(const section of graph.sections)if(section.content.trim()){
    // A preserved Markdown document already carries its headings; avoid nesting it under a duplicate title.
    if(/^#{1,6}\s/m.test(section.content.trim())&&['原有正文','补充说明'].includes(section.title))out.push(section.content.trim(),'');
    else out.push(`## ${section.title}`,'',section.content.trim(),'');
  }
  return out.join('\n').trim()+'\n';
}

export function needsGraphSync(variant) {
  return !!variant?.graph && variant.body !== compileGraph(variant.graph);
}

export function autoLayout(value) {
  const graph=normalizeGraph(value), byId=new Map(graph.nodes.map(n=>[n.id,n]));
  const flow=graph.edges.filter(e=>e.kind==='flow'&&byId.has(e.source)&&byId.has(e.target));
  const levels=new Map(), queue=graph.nodes.filter(n=>!annotationTypes.has(n.type)&&!flow.some(e=>e.target===n.id)).map(n=>[n.id,0]);
  while(queue.length){const [id,level]=queue.shift();if(levels.has(id))continue;levels.set(id,level);for(const edge of flow.filter(e=>e.source===id))if(!levels.has(edge.target))queue.push([edge.target,level+1]);}
  const rows=new Map();let orphan=0;
  for(const node of graph.nodes){const level=levels.get(node.id)??orphan++;const row=rows.get(level)||0;node.x=60+level*300;node.y=70+row*170;rows.set(level,row+1);}
  return graph;
}
