import { nodeTypes, annotationTypes, createGraph, normalizeGraph, compileGraph, graphWarnings, needsGraphSync, autoLayout } from './skill-graph.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=prefix=>`${prefix}-${crypto.randomUUID()}`;
let activeCleanup=()=>{};

export function skillCanvasShell() { return '<section id="skill-canvas" class="skill-canvas" aria-label="Skill 可视化编排"></section>'; }

export function mountSkillCanvas(root,{variant,files,models,isCurrent,onChange,notice}) {
  activeCleanup();
  if(!root)return;
  let selected=null,connectFrom=null,zoom=1,drag=null,request=null,status='',showIgnored=false;
  const undo=[],redo=[];
  const graph=()=>variant.graph;
  const snapshot=()=>JSON.stringify({graph:graph(),body:variant.body});
  const remember=()=>{undo.push(snapshot());if(undo.length>80)undo.shift();redo.length=0;};
  const current=()=>root.isConnected&&isCurrent();
  const $=s=>root.querySelector(s);
  const all=s=>[...root.querySelectorAll(s)];
  const pending=()=>needsGraphSync(variant);
  const announce=message=>{status=message;const el=$('[data-canvas-status]');if(el)el.textContent=message;};
  function changed(semantic=true){
    if(semantic&&graph())variant.body=compileGraph(graph());
    onChange();draw();warnings();syncStatus();
  }
  function mutate(fn,semantic=true){
    if(semantic&&pending()){announce('正文有未同步修改，请先点击「AI 同步到现有图」。');return false;}
    remember();fn();changed(semantic);return true;
  }
  function syncStatus(){
    const need=pending();
    const el=$('[data-sync-status]');if(el){el.textContent=need?'正文已修改 · 请先 AI 同步到现有图，再保存新版本':'直接编辑画板，正文自动生成 · 检查仅作提醒';el.classList.toggle('pending',need);}
    const sync=$('[data-action="sync"]');if(sync)sync.disabled=!graph()||!!request;
    const cancel=$('[data-action="cancel-ai"]');if(cancel)cancel.hidden=!request;
    all('[data-action="visualize"]').forEach(b=>b.disabled=!!request);
  }
  function render(){
    root.innerHTML=`<header class="sc-heading"><div><div class="sc-eyebrow">SKILL WORKFLOW</div><h3>可视化编排 <span class="pill gray">推荐</span></h3><p>流程、规则与资源在同一画板编辑，文字由程序自动整理。</p></div><div class="sc-ai"><label>转换模型<select data-model aria-label="画板转换模型"><option value="">选择模型</option>${models.map(m=>`<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('')}</select></label><button type="button" class="btn" data-action="visualize">${graph()?'AI 重新整理全文':'AI 自动转为画板'}</button><button type="button" class="btn" data-action="sync" ${graph()?'':'disabled'}>AI 同步到现有图</button><button type="button" class="btn" data-action="cancel-ai" hidden>取消等待</button></div></header>
    <div class="sc-sync" data-sync-status role="status"></div><div class="sc-request-status" data-canvas-status role="status">${esc(status)}</div>
    ${graph()?`<div class="sc-toolbar"><label class="sc-add">添加卡片<select data-new-type aria-label="新卡片类型">${Object.entries(nodeTypes).map(([key,title])=>`<option value="${key}" ${key==='step'?'selected':''}>${title}</option>`).join('')}</select></label><button type="button" class="btn btn-sm" data-action="add">＋ 添加</button><button type="button" class="btn btn-sm" data-action="connect">连接节点</button><button type="button" class="btn btn-sm" data-action="layout">自动布局</button><button type="button" class="btn btn-sm" data-action="undo" ${undo.length?'':'disabled'}>撤销</button><button type="button" class="btn btn-sm" data-action="redo" ${redo.length?'':'disabled'}>重做</button><span class="sc-spacer"></span><button type="button" class="btn btn-sm" data-action="zoom-out" aria-label="缩小画板">−</button><span data-zoom>100%</span><button type="button" class="btn btn-sm" data-action="zoom-in" aria-label="放大画板">＋</button><button type="button" class="btn btn-sm" data-action="fit">适应</button><button type="button" class="btn btn-sm" data-action="export">导出画板</button><button type="button" class="btn btn-sm" data-action="import">导入画板</button><input type="file" data-import accept=".json,application/json" hidden></div>
    <div class="sc-workspace"><div class="sc-viewport" tabindex="0" aria-label="工作流画板，拖动空白处平移"><div class="sc-extent"><div class="sc-plane"><svg class="sc-links" aria-label="流程连线"></svg><div class="sc-cards"></div></div></div></div><aside class="sc-inspector" aria-label="卡片与连线详情"></aside></div>
    <div class="sc-help">拖动卡片调整位置；点击右侧圆点，再点击目标卡片建立连接。双击连线添加 Key Point。虚线为规则关联。空白处拖动可平移。</div>
    <details class="sc-warnings"><summary>画板提醒 <span data-warning-count></span> · 可忽略，不影响生成与保存</summary><div data-warnings></div><button type="button" class="btn btn-sm" data-action="show-ignored">查看已移除提醒</button></details>
    <details class="sc-sections" ${graph().sections.length?'open':''}><summary>保留文字与修改建议 <span>${graph().sections.length} 个章节</span></summary><p>这里保留不适合画图的内容。正文参与文档生成，修改建议仅供编辑参考。</p><div data-sections></div><button type="button" class="btn btn-sm" data-action="add-section">＋ 添加文字章节</button></details>
    <details class="sc-preview"><summary>实时生成正文</summary><pre data-generated></pre></details>`:`<div class="sc-empty"><div class="sc-empty-symbol">◇ → ◇</div><strong>从已有文字生成，或从空白画板开始</strong><p>AI 自动选择适合可视化的章节；背景、示例等文字会保留，并附上修改建议。</p><button type="button" class="btn btn-primary" data-action="create">创建画板</button><span>创建时保留当前正文，可稍后整理。</span></div>`}`;
    const preferred=models.find(m=>m.id===root.dataset.modelId)||models[0];if(preferred)$('[data-model]').value=preferred.id;
    $('[data-model]').onchange=e=>root.dataset.modelId=e.target.value;
    draw();inspector();warnings();sections();syncStatus();
  }
  function draw(){
    if(!graph()||!$('.sc-plane'))return;
    const g=graph();let width=1200,height=650;
    for(const n of g.nodes){width=Math.max(width,n.x+330);height=Math.max(height,n.y+220);}
    $('.sc-extent').style.cssText=`width:${width*zoom}px;height:${height*zoom}px`;
    $('.sc-plane').style.cssText=`width:${width}px;height:${height}px;transform:scale(${zoom})`;
    $('.sc-cards').innerHTML=g.nodes.map(n=>`<article class="sc-card sc-${n.type}${selected?.id===n.id?' selected':''}${connectFrom===n.id?' connecting':''}" data-node="${esc(n.id)}" tabindex="0" aria-label="${esc(nodeTypes[n.type]+'：'+(n.title||'未命名'))}" style="left:${n.x}px;top:${n.y}px"><button type="button" class="sc-port sc-in" data-port="in" aria-label="连接到此节点"></button><div class="sc-card-type">${esc(nodeTypes[n.type])}${annotationTypes.has(n.type)?`<span>${esc({global:'全局',node:'步骤',edge:'连线',group:'区域'}[n.scope])}</span>`:''}</div><strong>${esc(n.title||'未命名')}</strong><p>${esc(n.text||n.resource||'点击编辑详细内容')}</p>${n.groupId?`<small>所属：${esc(g.nodes.find(v=>v.id===n.groupId)?.title||'未指定区域')}</small>`:''}<button type="button" class="sc-port sc-out" data-port="out" aria-label="从此节点连接"></button></article>`).join('');
    const byId=new Map(g.nodes.map(n=>[n.id,n]));
    const svg=$('.sc-links');svg.setAttribute('width',width);svg.setAttribute('height',height);
    svg.innerHTML='<defs><marker id="sc-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor"/></marker></defs>'+g.edges.map(e=>{
      const a=byId.get(e.source),b=byId.get(e.target);if(!a||!b)return '';
      const x=a.x+224,y=a.y+57,tx=b.x,ty=b.y+57;
      const bend=Math.max(70,Math.abs(tx-x)/2),d=e.source===e.target?`M ${x} ${y} C ${x+140} ${y-180},${a.x-140} ${y-180},${tx} ${ty}`:`M ${x} ${y} C ${x+bend} ${y},${tx-bend} ${ty},${tx} ${ty}`;
      return `<g data-edge="${esc(e.id)}" class="sc-edge ${e.kind}${selected?.id===e.id?' selected':''}"><path class="sc-edge-hit" d="${d}"/><path class="sc-edge-line" d="${d}" ${e.kind==='flow'?'marker-end="url(#sc-arrow)"':''}/><text x="${(x+tx)/2}" y="${(y+ty)/2-10}" text-anchor="middle">${esc(e.label||'')}</text></g>`;
    }).join('');
    $('[data-zoom]').textContent=Math.round(zoom*100)+'%';
    const preview=$('[data-generated]');if(preview)preview.textContent=compileGraph(g);
    const ub=$('[data-action="undo"]'),rb=$('[data-action="redo"]');if(ub)ub.disabled=!undo.length;if(rb)rb.disabled=!redo.length;
  }
  const input=(name,label,value,textarea=false)=>`<label class="sc-field">${label}${textarea?`<textarea data-prop="${name}">${esc(value)}</textarea>`:`<input data-prop="${name}" value="${esc(value)}">`}</label>`;
  const choices=(name,label,value,items)=>`<label class="sc-field">${label}<select data-prop="${name}">${items.map(([key,title])=>`<option value="${esc(key)}" ${key===value?'selected':''}>${esc(title)}</option>`).join('')}</select></label>`;
  function inspector(){
    const host=$('.sc-inspector');if(!host)return;
    const g=graph(),node=selected?.kind==='node'?g.nodes.find(n=>n.id===selected.id):null,edge=selected?.kind==='edge'?g.edges.find(e=>e.id===selected.id):null;
    if(!node&&!edge){host.innerHTML='<div class="sc-inspector-empty"><b>编辑内容与关系</b><p>选中卡片或连线后，在这里编辑。</p><p>允许留空；软件会提醒，Agent 可结合上下文判断。</p><p>选择“流程区域”可组织多个步骤；子流程卡片可引用区域或入口。</p></div>';return;}
    if(edge){host.innerHTML=`<h4>连线详情</h4>${choices('source','起点',edge.source,g.nodes.map(n=>[n.id,n.title||nodeTypes[n.type]]))}${choices('target','终点',edge.target,g.nodes.map(n=>[n.id,n.title||nodeTypes[n.type]]))}${choices('kind','关系',edge.kind,[['flow','执行顺序'],['attachment','规则关联']])}${input('label','条件／连线说明',edge.label,true)}<button type="button" class="btn" data-action="edge-keypoint">在线上添加 Key Point</button><button type="button" class="btn" data-action="edge-boundary">在线上添加边界条件</button><button type="button" class="btn btn-danger" data-action="delete">删除连线</button>`;return;}
    const isRule=annotationTypes.has(node.type),groups=g.nodes.filter(n=>n.type==='group'&&n.id!==node.id);
    host.innerHTML=`<h4>${esc(nodeTypes[node.type])}详情</h4>${choices('type','卡片类型',node.type,Object.entries(nodeTypes))}${input('title','名称',node.title)}${input('text',node.type==='note'?'作者便签（不进入文档）':'完整说明',node.text,true)}
    ${isRule?`${choices('scope','作用范围',node.scope,[['global','整个 Skill'],['node','某个步骤'],['edge','某条连线'],['group','某个流程区域']])}${choices('severity','规则性质',node.severity,[['','未指定'],['建议','建议'],['必须','必须'],['禁止','禁止']])}<label class="sc-field">关联对象（可多选）<select data-targets multiple size="4">${(node.scope==='edge'?g.edges.map(e=>[e.id,`${g.nodes.find(n=>n.id===e.source)?.title||'未命名'} → ${g.nodes.find(n=>n.id===e.target)?.title||'未命名'} ${e.label}`]):g.nodes.filter(n=>n.id!==node.id&&(node.scope!=='group'||n.type==='group')).map(n=>[n.id,n.title||nodeTypes[n.type]])).map(([id,title])=>`<option value="${esc(id)}" ${node.targets.includes(id)?'selected':''}>${esc(title)}</option>`).join('')}</select></label>`:`${input('input','输入／前置条件',node.input,true)}${input('output','输出／完成条件',node.output,true)}${input('verification','验证标准',node.verification,true)}${input('failure','失败处理',node.failure,true)}`}
    ${node.type==='decision'?input('condition','判断依据',node.condition,true):''}${node.type==='parallel'?choices('parallelMode','并行方式',node.parallelMode,[['','Agent 结合上下文判断'],['allowed','允许并行'],['required','要求并行']]):''}${node.type==='join'?choices('joinMode','汇合方式',node.joinMode,[['','Agent 结合上下文判断'],['all','等待全部完成'],['any','任意一个完成']]):''}${node.type==='loop'?input('exitCondition','退出条件',node.exitCondition,true)+input('limit','重复上限',node.limit):''}
    ${input('resource','工具／脚本／参考文档路径',node.resource)}${groups.length?choices('groupId','所属流程区域',node.groupId,[['','未指定'],...groups.map(n=>[n.id,n.title||'未命名区域'])]):''}
    ${node.type==='subflow'?`<label class="sc-field">引用子流程入口／区域<select data-targets multiple size="4">${g.nodes.filter(n=>n.id!==node.id&&!annotationTypes.has(n.type)).map(n=>`<option value="${esc(n.id)}" ${node.targets.includes(n.id)?'selected':''}>${esc(n.title||nodeTypes[n.type])}</option>`).join('')}</select></label>`:''}
    <button type="button" class="btn" data-action="start-connection">从此卡片连接</button><button type="button" class="btn btn-danger" data-action="delete">删除卡片</button>`;
  }
  function warnings(){
    const host=$('[data-warnings]');if(!host||!graph())return;
    const items=graphWarnings(graph(),files()),visible=items.filter(w=>showIgnored?w.dismissed:!w.dismissed);
    $('[data-warning-count]').textContent=items.filter(w=>!w.dismissed).length;
    host.innerHTML=visible.length?visible.map(w=>`<div class="sc-warning"><button type="button" class="sc-warning-focus" data-focus="${esc(w.nodeId||'')}">${esc(w.message)}</button><button type="button" class="btn btn-sm" data-dismiss="${esc(w.id)}">${w.dismissed?'恢复提醒':'移除提示'}</button></div>`).join(''):`<p>${showIgnored?'暂无已移除提醒。':'暂无提醒；仍可自由编辑与保存。'}</p>`;
    $('[data-action="show-ignored"]').textContent=showIgnored?'返回当前提醒':'查看已移除提醒';
  }
  function sections(){const host=$('[data-sections]');if(!host||!graph())return;host.innerHTML=graph().sections.map((s,i)=>`<article class="sc-section" data-section="${i}"><label class="sc-field">章节名称<input data-section-field="title" value="${esc(s.title)}"></label><label class="sc-field">保留正文<textarea data-section-field="content">${esc(s.content)}</textarea></label><label class="sc-field">修改建议（不进入 Skill 正文）<textarea data-section-field="suggestion">${esc(s.suggestion)}</textarea></label><button type="button" class="btn btn-sm" data-remove-section="${i}">删除章节</button></article>`).join('');}
  function addNode(type,extra={}){
    const viewport=$('.sc-viewport');let id;
    if(!mutate(()=>{id=uid('node');const node=normalizeGraph({nodes:[{id,type,title:nodeTypes[type],x:40+(viewport?.scrollLeft||0)/zoom+graph().nodes.length%3*65,y:50+(viewport?.scrollTop||0)/zoom+graph().nodes.length%4*50,...extra}],edges:[]}).nodes[0];graph().nodes.push(node);selected={kind:'node',id};}))return;
    inspector();
  }
  function link(target){if(!connectFrom||!graph())return;const source=connectFrom;connectFrom=null;mutate(()=>{const a=graph().nodes.find(n=>n.id===source),b=graph().nodes.find(n=>n.id===target);graph().edges.push({id:uid('edge'),source,target,label:'',kind:annotationTypes.has(a.type)||annotationTypes.has(b.type)?'attachment':'flow'});});inspector();announce('连线已添加，可选中填写条件或说明。');}
  async function runAI(mode){
    if(request)return;
    const modelId=$('[data-model]').value;if(!modelId)return notice('请先配置并选择模型服务。',true);
    root.dataset.modelId=modelId;
    const captured=JSON.stringify({variant,files:files()});const controller=new AbortController();request=controller;
    syncStatus();announce(mode==='sync'?'正在根据现有画板与文字修改同步…':'正在自动选择适合可视化的章节…');
    try{
      const response=await fetch('/api/skill-visualization',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({modelId,mode,variant,files:Object.fromEntries(Object.keys(files()).map(name=>[name,'']))}),signal:controller.signal});
      const result=await response.json();if(!response.ok)throw Error(result.error||'转换失败');
      if(!current()||JSON.stringify({variant,files:files()})!==captured){if(current())announce('编辑内容已变化，本次结果未覆盖草稿。请重新同步。');return;}
      remember();variant.graph=normalizeGraph(result.graph);variant.body=compileGraph(variant.graph);selected=null;request=null;status=result.summary||'画板已更新，请检查并保存版本。';render();onChange();
    }catch(error){if(current())announce(error.name==='AbortError'?'已取消等待，原草稿保留。':error.message);}
    finally{if(request===controller)request=null;if(current())syncStatus();}
  }
  function restore(from,to){if(!from.length)return;if(pending()){announce('请先同步正文修改，再撤销画板操作。');return;}to.push(snapshot());const value=JSON.parse(from.pop());variant.graph=value.graph;variant.body=value.body;selected=null;render();onChange();}
  root.onclick=event=>{
    const action=event.target.closest('[data-action]')?.dataset.action;
    if(action==='create'){remember();variant.graph=createGraph(variant.body);variant.body=compileGraph(variant.graph);render();onChange();return;}
    if(action==='visualize'||action==='sync'){runAI(action==='sync'?'sync':'visualize');return;}
    if(action==='cancel-ai'){request?.abort();return;}
    if(!graph())return;
    const focus=event.target.closest('[data-focus]');if(focus){selected={kind:'node',id:focus.dataset.focus};draw();inspector();const n=graph().nodes.find(n=>n.id===selected.id);if(n){$('.sc-viewport').scrollLeft=Math.max(0,n.x*zoom-50);$('.sc-viewport').scrollTop=Math.max(0,n.y*zoom-50);}return;}
    const dismiss=event.target.closest('[data-dismiss]');if(dismiss){mutate(()=>{const id=dismiss.dataset.dismiss;graph().dismissedWarnings=graph().dismissedWarnings.includes(id)?graph().dismissedWarnings.filter(v=>v!==id):[...graph().dismissedWarnings,id];},false);return;}
    const removeSection=event.target.closest('[data-remove-section]');if(removeSection){if(mutate(()=>graph().sections.splice(Number(removeSection.dataset.removeSection),1)))sections();return;}
    if(action==='add'){addNode($('[data-new-type]').value);return;}
    if(action==='connect'||action==='start-connection'){if(selected?.kind!=='node'){announce('请先选中起点卡片，再点击连接节点。');return;}connectFrom=selected.id;draw();announce('请点击目标卡片，或目标卡片左侧圆点。');return;}
    if(action==='layout'){mutate(()=>variant.graph=autoLayout(graph()),false);return;}
    if(action==='undo'){restore(undo,redo);return;}if(action==='redo'){restore(redo,undo);return;}
    if(action==='zoom-in'||action==='zoom-out'){zoom=Math.min(1.8,Math.max(.3,zoom+(action==='zoom-in'?.1:-.1)));draw();return;}
    if(action==='fit'){const w=Math.max(900,...graph().nodes.map(n=>n.x+300));zoom=Math.min(1,Math.max(.3,$('.sc-viewport').clientWidth/w));$('.sc-viewport').scrollTo(0,0);draw();return;}
    if(action==='export'){const url=URL.createObjectURL(new Blob([JSON.stringify(graph(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='skill-workflow.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
    if(action==='import'){$('[data-import]').click();return;}
    if(action==='show-ignored'){showIgnored=!showIgnored;warnings();return;}
    if(action==='add-section'){if(mutate(()=>graph().sections.push({id:uid('section'),title:'补充说明',content:'',suggestion:''})))sections();return;}
    if(action==='edge-keypoint'||action==='edge-boundary'){const edge=graph().edges.find(e=>e.id===selected?.id);if(edge)addNode(action==='edge-keypoint'?'keypoint':'boundary',{scope:'edge',targets:[edge.id]});return;}
    if(action==='delete'){
      mutate(()=>{if(selected?.kind==='node'){graph().nodes=graph().nodes.filter(n=>n.id!==selected.id);graph().edges=graph().edges.filter(e=>e.source!==selected.id&&e.target!==selected.id);}else graph().edges=graph().edges.filter(e=>e.id!==selected?.id);selected=null;});inspector();return;
    }
    const node=event.target.closest('[data-node]');if(node){if(connectFrom&&!(event.target.closest('[data-port]')?.dataset.port==='out')){link(node.dataset.node);return;}selected={kind:'node',id:node.dataset.node};if(event.target.closest('[data-port]')?.dataset.port==='out'){connectFrom=selected.id;announce('请点击目标卡片完成连线。');}draw();inspector();return;}
    const edge=event.target.closest('[data-edge]');if(edge){selected={kind:'edge',id:edge.dataset.edge};draw();inspector();}
  };
  root.ondblclick=event=>{const edge=event.target.closest('[data-edge]');if(edge)addNode('keypoint',{scope:'edge',targets:[edge.dataset.edge]});};
  root.oninput=event=>{
    const prop=event.target.dataset.prop;if(prop){const obj=selected?.kind==='node'?graph().nodes.find(n=>n.id===selected.id):graph().edges.find(e=>e.id===selected?.id);if(obj&&mutate(()=>obj[prop]=event.target.value)){if(['type','scope'].includes(prop))inspector();}return;}
    const sf=event.target.dataset.sectionField;if(sf){const section=graph().sections[Number(event.target.closest('[data-section]').dataset.section)];if(section)mutate(()=>section[sf]=event.target.value,sf!=='suggestion');}
  };
  root.onchange=async event=>{
    if(event.target.matches('[data-targets]')){const node=graph().nodes.find(n=>n.id===selected?.id);if(node)mutate(()=>node.targets=[...event.target.selectedOptions].map(v=>v.value));}
    if(event.target.matches('[data-import]')){const file=event.target.files[0];try{if(!file)return;if(file.size>2_000_000)throw Error('画板文件超过 2 MB');const imported=normalizeGraph(JSON.parse(await file.text()));if(current()&&mutate(()=>variant.graph=imported))render();}catch(error){notice(error.message,true);}finally{event.target.value='';}}
  };
  root.onpointerdown=event=>{
    if(event.button!==0||event.target.closest('button,input,select,textarea,[data-edge]'))return;
    const viewport=event.target.closest('.sc-viewport');if(!viewport)return;
    const card=event.target.closest('[data-node]');
    if(card){const node=graph().nodes.find(n=>n.id===card.dataset.node);remember();selected={kind:'node',id:node.id};drag={type:'node',id:node.id,x:event.clientX,y:event.clientY,nx:node.x,ny:node.y,moved:false};inspector();}
    else drag={type:'pan',x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
    root.setPointerCapture(event.pointerId);
  };
  root.onpointermove=event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(drag.type==='node'){const node=graph().nodes.find(n=>n.id===drag.id);node.x=Math.max(0,drag.nx+dx/zoom);node.y=Math.max(0,drag.ny+dy/zoom);drag.moved=drag.moved||Math.abs(dx)+Math.abs(dy)>3;draw();}else{const viewport=$('.sc-viewport');viewport.scrollLeft=drag.left-dx;viewport.scrollTop=drag.top-dy;}};
  root.onpointerup=event=>{if(!drag)return;const moved=drag.moved;drag=null;if(root.hasPointerCapture(event.pointerId))root.releasePointerCapture(event.pointerId);if(moved){onChange();draw();}};
  root.onpointercancel=()=>{drag=null;};
  root.onkeydown=event=>{if(event.target.matches('input,textarea,select'))return;if(event.key==='Escape'){connectFrom=null;draw();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();restore(event.shiftKey?redo:undo,event.shiftKey?undo:redo);}};
  const bodyListener=()=>{syncStatus();onChange();};
  const body=document.querySelector('#skill-body');body?.addEventListener('input',bodyListener);
  activeCleanup=()=>{request?.abort();body?.removeEventListener('input',bodyListener);};
  render();
  return {refresh:()=>{warnings();syncStatus();}};
}
