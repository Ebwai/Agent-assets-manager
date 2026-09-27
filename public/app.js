const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const deep = value => structuredClone(value);
const labels = { home:'首页', skill:'Skills', workflow:'多个 Skills 包联动套件', prompt:'系统提示词', agent:'Agent', project:'项目', model:'模型服务', settings:'审查配置', deploy:'一键生效', sync:'远程同步' };
const icons = { home:'⌂', skill:'◇', workflow:'↳', prompt:'≡', agent:'◈', project:'▣', model:'◉', settings:'⚙', deploy:'↗', sync:'⇄' };
const state = { assets:{}, sync:{}, section:'home', selected:null, draft:null, variant:'common', query:'', deployment:null, openFields:{}, openYamlGroups:{}, skillsNavOpen:false, profileDrafts:{} };
const profiledTypes = new Set(['skill','workflow','prompt','agent']);
const profileFields = {skill:['description','variants','files'],workflow:['description','members','skillIds'],prompt:['description','scope','target','content'],agent:['description','harness','modelId','instructions','skillIds','workflowIds','promptIds','tools','mcps']};
const modal = $('#modal');
const standard = [
  { key:'name', label:'name', required:true, purpose:'Skill 的唯一标识，也是目录名。', practice:'使用明确的能力名称，如 pdf-extraction；1–64 位小写字母、数字和连字符，不能连续使用连字符。', example:'pdf-extraction', check:v=> /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v||'') && v.length<=64 },
  { key:'description', label:'description', required:true, purpose:'让 Agent 在列表阶段判断何时加载 Skill。', practice:'先说做什么，再写触发时机和同义表达。既覆盖用户常见说法，也写清边界，避免误触发。Claude Code 可适度写得积极一些。', example:'提取 PDF 文本与表格。用户要求解析 PDF、读取扫描件或导出表格时使用。', check:v=>!!String(v||'').trim()&&v.length<=1024 },
  { key:'license', label:'license', purpose:'声明 Skill 的授权条款。', practice:'使用简短的 SPDX 标识或指向包内许可文件。', example:'Apache-2.0' },
  { key:'compatibility', label:'compatibility', purpose:'说明运行环境或依赖要求。', practice:'只在确有特定要求时填写，如操作系统、可执行程序或联网条件；不超过 500 字符。', example:'Requires Python 3.11+ and network access', check:v=>!v||v.length<=500 },
  { key:'metadata', label:'metadata', purpose:'自定义字符串键值元数据，可记录版本、作者等。', practice:'建议至少记录 version；键名清楚，不与其他 frontmatter 字段同名。', example:'version: 1.0.0\nauthor: team' },
];
const claude = [
  { key:'allowed-tools', label:'allowed-tools', purpose:'预批准此 Skill 调用当轮所需的 Claude Code 工具。', practice:'只列执行该任务确实需要的工具；这不是限制其他工具的白名单。', example:'Read Grep Bash(git:*)' },
  {key:'when_to_use',label:'when_to_use',purpose:'补充自动触发场景。',practice:'写典型请求或上下文；与 description 合计会受列表长度限制。',example:'当用户提到扫描件、发票 OCR 或 PDF 文本提取时。'},
  {key:'argument-hint',label:'argument-hint',purpose:'斜杠菜单中的参数提示。',practice:'用短格式表达参数位置。',example:'[filename] [format]'},
  {key:'arguments',label:'arguments',purpose:'定义正文中使用的命名位置参数。',practice:'按顺序列参数名，并在正文用 $name 引用。',example:'file format'},
  {key:'disable-model-invocation',label:'disable-model-invocation',purpose:'禁止 Claude 自动触发，仅由用户手动调用。',practice:'部署、发布等高成本流程可设为 true。',example:'true',boolean:true},
  {key:'user-invocable',label:'user-invocable',purpose:'控制是否显示在用户的 / 菜单。',practice:'只供 Claude 自动使用的背景能力可设为 false。',example:'false',boolean:true},
  {key:'disallowed-tools',label:'disallowed-tools',purpose:'在 Skill 活跃期间移除指定工具。',practice:'仅限制与该流程冲突的工具。',example:'AskUserQuestion'},
  {key:'model',label:'model',purpose:'在本轮 Skill 执行时切换模型。',practice:'只在任务确实需要专门模型时使用。',example:'inherit'},
  {key:'effort',label:'effort',purpose:'本轮 Skill 的推理强度。',practice:'按复杂度设置 low、medium、high 等。',example:'high'},
  {key:'context',label:'context',purpose:'选择是否在独立子 Agent 上下文运行。',practice:'需要隔离长流程时填写 fork。',example:'fork'},
  {key:'agent',label:'agent',purpose:'context: fork 时指定子 Agent 类型。',practice:'选择宿主中真实存在的 Agent。',example:'Explore'},
  {key:'paths',label:'paths',purpose:'限定自动触发的文件路径。',practice:'使用与任务相关的 glob，避免范围过广。',example:'src/**/*.ts, tests/**/*.ts'},
  {key:'shell',label:'shell',purpose:'动态命令使用的 Shell。',practice:'Windows PowerShell 环境可指定 powershell。',example:'powershell'},
];
const fields = [...standard, ...claude];
const toolCatalog = [
  { group:'文件与代码', items:[['Read','读取文件'],['Glob','按名称查找文件（部分平台默认不提供）'],['Grep','搜索文件内容（部分平台默认不提供）'],['LSP','语言服务检索'],['Edit','修改文件'],['Write','创建或覆盖文件'],['NotebookEdit','编辑 Notebook']] },
  { group:'执行与网络', items:[['Bash','运行 Shell 命令'],['PowerShell','运行 PowerShell（按平台和设置提供）'],['WebFetch','获取网页'],['WebSearch','网页搜索']] },
  { group:'协作与扩展', items:[['Agent','启动子 Agent'],['AskUserQuestion','向用户提问'],['Skill','调用 Skill'],['ListMcpResourcesTool','列出 MCP 资源'],['ReadMcpResourceTool','读取 MCP 资源']] },
];
const codexToolCatalog = [
  { group:'代码与文件', items:[['shell','运行命令并读取项目文件'],['apply_patch','通过补丁修改文件'],['view_image','查看本地图片（可配置）']] },
  { group:'检索与计划', items:[['web_search','搜索网页（可配置）'],['update_plan','维护任务计划']] },
];
const toolSources = {
  claude:{ name:'Claude Code', version:'2.1.197', url:'https://code.claude.com/docs/en/tools-reference', detail:'本机版本；部分工具受平台、设置和权限模式影响。' },
  codex:{ name:'Codex CLI', version:'0.155.0-alpha.16.4', url:'https://learn.chatgpt.com/docs/config-file/config-reference', detail:'本机版本；只列已核对的内建能力，MCP 工具由实际连接决定。' },
};
const knownTools = new Set(toolCatalog.flatMap(group=>group.items.map(([name])=>name)));
function catalogFor(harness) { return harness==='codex'?codexToolCatalog:toolCatalog; }
function catalogNames(harness) { return new Set(catalogFor(harness).flatMap(group=>group.items.map(([name])=>name))); }
function toolSource(harness) { const source=toolSources[harness==='codex'?'codex':'claude']; return `<div class="tool-source"><strong>工具数据基准：${source.name} v${source.version}</strong><a href="${source.url}" target="_blank" rel="noopener noreferrer">官方依据 ↗</a><small>${source.detail}</small></div>`; }
function toolChoices(groups,selected,attribute) { return `<div class="tool-groups">${groups.map(group=>`<div class="tool-group"><h4>${group.group}</h4>${group.items.map(([name,info])=>`<label class="tool-choice"><input type="checkbox" ${attribute}="${name}" ${selected.includes(name)?'checked':''}><span><strong>${name}</strong><small>${info}</small></span></label>`).join('')}</div>`).join('')}</div>`; }
function toolRules(value) { return String(value||'').match(/[^\s,()]+(?:\([^)]*\))?/g)||[]; }
function notice(message, error=false) { const n=$('#notice'); n.textContent=message; n.className=`notice show${error?' error':''}`; clearTimeout(notice.timer); notice.timer=setTimeout(()=>n.className='notice',5000); }
async function api(path, method='GET', body) { const res=await fetch('/api/'+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined}); const data=await res.json(); if(!res.ok) throw new Error(data.error||'操作失败'); return data; }
async function refresh() { const data=await api('bootstrap'); state.assets=data.assets; state.sync=data.sync||{}; if(state.selected && !state.assets[state.section]?.some(a=>a.id===state.selected)) state.selected=null; render(); }
function options(type, selected='', blank='请选择') { return `<option value="">${blank}</option>${(state.assets[type]||[]).map(a=>`<option value="${escapeHtml(a.id)}" ${a.id===selected?'selected':''}>${escapeHtml(type==='model'?`${a.title||a.name} · ${a.model}`:a.title||a.name)}</option>`).join('')}`; }
function nav() {
  const item=t=>`<button class="nav-item ${state.section===t?'active':''}" data-nav="${t}" data-tooltip="${labels[t]}" aria-label="${labels[t]}" title="${labels[t]}"><span class="ico">${icons[t]}</span><span>${labels[t]}</span>${state.assets[t]&&t!=='settings'?`<span class="nav-count">${state.assets[t].length}</span>`:''}</button>`;
  const skillCount=(state.assets.skill?.length||0)+(state.assets.workflow?.length||0);
  $('#nav').innerHTML=`<div class="nav-label">总览</div>${item('home')}<div class="nav-label">资产库</div>
    <div class="nav-skill-group"><button class="nav-item nav-skills-toggle ${['skill','workflow'].includes(state.section)?'active':''}" id="skills-nav-toggle" aria-label="Skills 分类" data-tooltip="Skills 分类" title="Skills 分类" aria-expanded="${state.skillsNavOpen}" aria-controls="skills-nav-submenu"><span class="ico">${icons.skill}</span><span>Skills</span><span class="nav-count">${skillCount}</span><span class="nav-chevron" aria-hidden="true">⌄</span></button>
    <div class="nav-submenu ${state.skillsNavOpen?'open':''}" id="skills-nav-submenu">${[['skill','单个 Skills 包','1'],['workflow','多个 Skills 联动套件','2']].map(([type,label,icon])=>`<button class="nav-subitem ${state.section===type?'active':''}" data-nav="${type}" aria-label="${label}"><span class="nav-subicon">${icon}</span><span class="nav-subtext">${label}</span></button>`).join('')}</div></div>
    ${item('prompt')}${item('agent')}<div class="nav-label">运行环境</div>${['project','model','settings','deploy','sync'].map(item).join('')}`;
  $('#skills-nav-toggle').onclick=()=>{ state.skillsNavOpen=!state.skillsNavOpen; nav(); };
  $$('[data-nav]').forEach(button=>button.onclick=()=>selectSection(button.dataset.nav));
}
function selectSection(section) { state.section=section; state.selected=null; state.draft=null; state.query=''; state.variant='common'; state.openFields={}; state.openYamlGroups={}; state.profileDrafts={}; state.lastProfileCopy=null; if(['skill','workflow'].includes(section)) state.skillsNavOpen=true; render(); }
function emptyDraft(type) {
  const base={title:'',description:''};
  if(type==='skill') return {...base,variants:{common:{frontmatter:{name:'',description:'',metadata:{version:'1.0.0'}},descriptionParts:{what:'',when:'',keywords:''},body:'## Purpose / Overview\n\n## Core workflow\n\n1. \n\n## Input\n\n## Output\n\n## Key Points\n\n## Edge cases\n\n## Tools / resources\n\n## Verification\n'}},files:{}};
  if(type==='workflow') return {...base,members:[]};
  if(type==='prompt') return {...base,scope:'global',target:'',content:''};
  if(type==='agent') return {...base,harness:'claude',instructions:'',skillIds:[],workflowIds:[],promptIds:[],tools:[],mcps:[],modelId:''};
  if(type==='project') return {...base,directory:'',suiteIds:[]};
  if(type==='model') return {...base,baseUrl:'https://api.anthropic.com',model:'',apiKey:''};
  if(type==='settings') return {...base,title:'审查与改进提示词',reviewSystem:'',improveSystem:''};
}
function selectAsset(id) { state.selected=id; state.draft=deep((state.assets[state.section]||[]).find(x=>x.id===id)); state.profileDrafts={}; state.lastProfileCopy=null; state.variant='common'; state.openFields={}; state.openYamlGroups={}; render(); }
function newAsset() { state.selected=null; state.draft=emptyDraft(state.section); state.profileDrafts={}; state.lastProfileCopy=null; state.variant='common'; state.openFields={}; state.openYamlGroups={}; render(); }
function render() {
  nav();
  $('#page-title').textContent=labels[state.section];
  $('#breadcrumb').textContent=`WORKSPACE / ${state.section.toUpperCase()}`;
  $('#new-button').style.display=['home','deploy','settings','sync'].includes(state.section)?'none':'';
  $('#new-button').textContent=`＋ 新建${state.section==='skill'?' Skill':' '+labels[state.section]}`;
  $('#new-button').onclick=newAsset;
  if(state.section==='home') return renderHome();
  if(state.section==='deploy') return renderDeploy();
  if(state.section==='sync') return renderSync();
  if(state.section==='settings') { if(!state.draft) state.draft=deep((state.assets.settings||[])[0]||emptyDraft('settings')); return renderSettings(); }
  const section=state.section;
  const data=state.assets[section]||[];
  const filtered=data.filter(a=>`${a.title||a.name} ${a.description||''}`.toLowerCase().includes(state.query.toLowerCase()));
  const count=(t)=>state.assets[t]?.length||0;
  $('#content').innerHTML=`${section==='skill'?`<div class="stat-row"><div class="stat"><div class="num">${count('skill')}</div><div class="label">Skills</div></div><div class="stat"><div class="num">${count('workflow')}</div><div class="label">Skills 套件</div></div><div class="stat"><div class="num">${count('agent')}</div><div class="label">Agents</div></div><div class="stat"><div class="num">${count('project')}</div><div class="label">项目</div></div></div>`:''}
  <div class="intro"><div><h2>${section==='skill'?'可发现、可复用的任务能力包':labels[section]+'资产'}</h2><p>${section==='skill'?'列表只展示名称和说明；触发后才加载 SKILL.md，执行时再按需读取 references、scripts 与 assets。':introText[section]}</p></div></div>
  <div class="workspace"><aside class="panel"><div class="panel-head"><h3 class="panel-title">${labels[section]}列表</h3><span class="panel-sub">${data.length} 项</span></div><div class="list-tools"><input class="search" id="asset-search" placeholder="搜索名称或说明..." value="${escapeHtml(state.query)}"></div><div class="asset-list">${filtered.length?filtered.map(a=>`<button class="asset-item ${state.selected===a.id?'active':''}" data-select="${a.id}"><span class="asset-glyph">${icons[section]}</span><div><strong>${escapeHtml(a.title||a.name)}</strong><small>${section==='project'&&!a.directory?'待分配本机路径 · ':''}${escapeHtml(a.description||a.directory||a.model||'暂无说明')}</small></div></button>`).join(''):`<div class="empty"><span class="symbol">◇</span>${state.query?'没有匹配的资产':'还没有资产，点击右上角新建。'}</div>`}</div><div class="panel-head"><button class="btn btn-sm" id="trash-btn">查看已删除资产</button></div></aside><section class="panel" id="editor-panel">${state.draft?renderForm(section):`<div class="empty" style="padding:100px 24px"><span class="symbol">✧</span>选择左侧资产，或新建一个${labels[section]}。</div>`}</section></div>`;
  $('#asset-search').oninput=e=>{state.query=e.target.value; const pos=e.target.selectionStart; render(); $('#asset-search').focus(); $('#asset-search').setSelectionRange(pos,pos);};
  $$('[data-select]').forEach(b=>b.onclick=()=>selectAsset(b.dataset.select));
  $('#trash-btn').onclick=()=>showTrash(section);
  if(state.draft) bindForm(section);
}
function renderHome() {
  const count=type=>(state.assets[type]||[]).length;
  const child=(label,description,section,mode='',value='')=>`<button class="map-child" data-home-section="${section}" data-home-mode="${mode}" data-home-value="${value}"><span>${escapeHtml(label)}</span><small>${escapeHtml(description)}</small><b aria-hidden="true">↗</b></button>`;
  $('#content').innerHTML=`<div class="home-layout"><section class="map-surface" aria-label="Agent 资产关系图">
    <div class="map-caption"><span>ASSET MAP</span><span>点击节点进入配置</span></div>
    <button class="map-root" data-home-section="home"><span class="root-icon">✦</span><span><strong>Agent资产管理</strong><small>从提示词、Skills 到 Agent 的统一资产入口</small></span><span class="root-count">${count('skill')+count('workflow')+count('prompt')+count('agent')} 项资产</span></button>
    <div class="map-trunk" aria-hidden="true"></div><div class="map-columns">
      <div class="map-column"><button class="map-parent parent-prompt" data-home-section="prompt"><span class="map-parent-icon">≡</span><span><strong>系统提示词</strong><small>${count('prompt')} 个提示词层</small></span><b>↗</b></button><div class="map-children">
        ${child('针对项目','项目范围指令','prompt','new','project')}
        ${child('针对模型','模型专属指令','prompt','new','model')}
        ${child('针对 Harness 框架','Claude Code / Codex','prompt','new','software')}
      </div></div>
      <div class="map-column"><button class="map-parent parent-skill" data-home-section="skill"><span class="map-parent-icon">◇</span><span><strong>Skills</strong><small>${count('skill')} 个能力包</small></span><b>↗</b></button><div class="map-children">
        ${child('单 Skills 包','编辑 SKILL.md 与资源','skill','new')}
        ${child('多 Skills 包联动套件','归类并说明各 Skill 的作用','workflow','new')}
      </div></div>
      <div class="map-column"><button class="map-parent parent-agent" data-home-section="agent"><span class="map-parent-icon">◈</span><span><strong>Agent</strong><small>${count('agent')} 个 Agent 配置</small></span><b>↗</b></button><div class="map-children">
        ${child('模型配置','Anthropic 协议服务','model')}
        ${child('资产配置','Skills、套件与 MCP','agent')}
        ${child('系统提示词配置','组合与关联提示词','prompt')}
      </div></div>
      <div class="map-column"><button class="map-parent parent-environment" data-home-section="project"><span class="map-parent-icon">▣</span><span><strong>项目与应用</strong><small>${count('project')} 个目标项目</small></span><b>↗</b></button><div class="map-children">
        ${child('项目目录','登记本机项目','project')}
        ${child('Claude Code','预览并生效','deploy','','claude')}
        ${child('Codex','预览并生效','deploy','','codex')}
      </div></div>
    </div><div class="map-footnote">每个节点都是入口；资产保存时记录 Git 版本，生效前可预览目标文件。</div>
  </section><aside class="feature-rail" aria-label="常用功能"><div class="rail-heading"><span>功能</span><small>QUICK ACCESS</small></div>
    <button class="feature-tag" data-feature="history"><span class="feature-ico">↺</span><span><strong>版本管理</strong><small>查看历史并在本机选用</small></span><b>↗</b></button>
    <button class="feature-tag" data-feature="sync"><span class="feature-ico">⇄</span><span><strong>远程同步</strong><small>连接 GitHub 并同步资产</small></span><b>↗</b></button>
    <button class="feature-tag" data-feature="deploy"><span class="feature-ico">↗</span><span><strong>快速应用</strong><small>适配 Claude Code / Codex</small></span><b>↗</b></button>
    <button class="feature-tag" data-feature="review"><span class="feature-ico">✧</span><span><strong>智能提示</strong><small>审查 Skill 并获取建议</small></span><b>↗</b></button>
    <button class="feature-tag" data-feature="improve"><span class="feature-ico">◌</span><span><strong>反馈迭代</strong><small>描述问题并应用改进</small></span><b>↗</b></button>
  </aside></div>`;
  $$('[data-home-section]').forEach(button=>button.onclick=()=>{
    const section=button.dataset.homeSection;
    if(section==='home') return;
    if(section==='deploy'&&button.dataset.homeValue) state.deployment={...(state.deployment||{}),software:button.dataset.homeValue};
    selectSection(section);
    if(button.dataset.homeMode==='new') {
      newAsset();
      if(section==='prompt') { state.draft.scope=button.dataset.homeValue; render(); }
    }
  });
  $$('[data-feature]').forEach(button=>button.onclick=()=>{
    const action=button.dataset.feature;
    if(action==='history') return showRecentHistory();
    if(action==='sync') return selectSection('sync');
    if(action==='deploy') return selectSection('deploy');
    const first=(state.assets.skill||[])[0];
    if(!first) { selectSection('skill'); newAsset(); return notice('请先保存一个 Skill，再使用智能审查或反馈改进。',true); }
    selectSection('skill'); selectAsset(first.id); aiDialog(action==='review'?'review':'improve');
  });
}
async function showRecentHistory() {
  try {
    const items=await api('recent');
    showModal('最近的资产版本',items.length?`<div class="history">${items.map(item=>`<div class="history-row"><div class="history-top"><strong>${escapeHtml(item.title)}</strong><span class="scope-path">${escapeHtml(labels[item.type])}</span></div><p>${new Date(item.date).toLocaleString('zh-CN')} · ${escapeHtml(item.message)}</p><div class="buttons"><button class="btn btn-sm" data-open-history="${item.type}:${item.id}">查看版本历史</button></div></div>`).join('')}</div>`:'<div class="empty">保存第一项资产后，这里会显示 Git 版本。</div>');
    $$('[data-open-history]').forEach(button=>button.onclick=()=>{ const [type,id]=button.dataset.openHistory.split(':'); modal.close(); selectSection(type); selectAsset(id); showHistory(type,id); });
  } catch(error) { notice(error.message,true); }
}
const introText={workflow:'按用途把多个 Skills 归为一套，并说明每个 Skill 在其中的定位。套件可整体应用到项目。',prompt:'按通用、模型、软件、项目四层组合项目指令。',agent:'指定 Agent 的 Skills、套件、工具、MCP 与提示词。',project:'登记项目并关联默认 Skills 套件；每台电脑分别分配项目目录。',model:'配置 Anthropic 协议模型，用于 Skill 审查与改进。'};
function editorHead(type) { const d=state.draft; return `<div class="editor-head"><div><h2>${d.id?escapeHtml(d.title||d.name):'新建'+labels[type]}</h2><p>${d.activeVersion?`本机正使用历史版本 ${escapeHtml(d.activeVersion.slice(0,7))} · 选择版本不产生提交；保存修改才创建新版本`:d.id?`最近更新 ${new Date(d.updatedAt).toLocaleString('zh-CN')}`:'填写内容后保存为首个 Git 版本'}</p></div><div class="editor-actions">${d.id?`<button class="btn btn-sm" id="history-btn">版本历史</button><button class="btn btn-sm btn-danger" id="delete-btn">删除</button>`:''}${type==='skill'&&!d.id?'<button class="btn btn-sm" id="import-skill">导入已有 Skill</button><button class="btn btn-sm" id="import-local-skill">从本地目录导入</button><input id="local-skill-directory" type="file" webkitdirectory directory multiple hidden>':''}<button class="btn btn-sm btn-primary" id="save-btn">保存版本</button></div></div>`; }
function profileSnapshot(type, draft) { return Object.fromEntries(profileFields[type].filter(key=>Object.hasOwn(draft,key)).map(key=>[key,deep(draft[key])])); }
function profileChoice() {
  const d=state.draft, key=`${d.assetHarness||''}:${d.assetModelId||''}`, configured=!!d.profiles?.[key];
  return `<div class="asset-profile"><div class="section-title">此资产的适用版本</div><div class="form-grid"><div class="field"><label class="field-label" for="asset-harness">Harness 框架 <span class="pill">必选</span></label><select id="asset-harness"><option value="">请选择框架</option><option value="claude" ${d.assetHarness==='claude'?'selected':''}>Claude Code</option><option value="codex" ${d.assetHarness==='codex'?'selected':''}>Codex</option></select></div><div class="field"><label class="field-label" for="asset-model">模型版本 <span class="pill">必选</span></label><select id="asset-model">${options('model',d.assetModelId)}</select></div></div><p class="small-note">${!state.assets.model?.length?'请先在「模型服务」添加常用模型。':configured?'已保存此组合；编辑后保存会创建新的 Git 版本。':d.profiles&&Object.keys(d.profiles).length?'此组合尚未配置；可填写内容并保存新版本。':'保存时会把这份内容绑定到所选组合。'}</p>${state.lastProfileCopy&&!configured?'<button class="btn btn-sm" id="copy-profile">复制上一组合内容</button>':''}</div>`;
}
function renderForm(type) { return `<div class="editor">${editorHead(type)}${profiledTypes.has(type)?profileChoice():''}${({skill:renderSkillForm,workflow:renderWorkflowForm,prompt:renderPromptForm,agent:renderAgentForm,project:renderProjectForm,model:renderModelForm})[type]()}</div>`; }
function field(label,key,value,opts={}) { return `<div class="field ${opts.wide?'wide':''}"><label class="field-label" for="f-${key}">${label}${opts.required?'<span class="pill">必填</span>':''}</label>${opts.textarea?`<textarea id="f-${key}" data-bind="${key}" ${opts.code?'class="code"':''} placeholder="${escapeHtml(opts.placeholder||'')}">${escapeHtml(value)}</textarea>`:`<input id="f-${key}" data-bind="${key}" value="${escapeHtml(value)}" placeholder="${escapeHtml(opts.placeholder||'')}">`}${opts.hint?`<span class="hint">${opts.hint}</span>`:''}</div>`; }
function fieldSpec(s, f, variant, compact=false) {
  const value=f[s.key], required=s.required&&variant!=='claude';
  const tags=`${required?'<span class="pill">必须</span>':''}${['作用','最佳实践','例子'].map(tag=>`<button class="tag" data-help="${s.key}" data-help-tag="${tag}">${tag}</button>`).join('')}<button class="check-btn" data-check="${s.key}" title="检查此项">✓ 检查</button>`;
  const heading=`<div class="field-label">${compact?'':s.label} ${tags}</div>`;
  if(s.key==='description') { const parts=state.draft.variants[variant].descriptionParts||{what:value||'',when:'',keywords:''}; return `<div class="field wide">${heading}<div class="description-parts">${['what','when','keywords'].map((p,i)=>`<div><label>${['WHAT · 做什么','WHEN · 何时使用','KEYWORDS · 相关表达'][i]}</label><input data-part="${p}" aria-label="${['WHAT 做什么','WHEN 何时使用','KEYWORDS 相关表达'][i]}" value="${escapeHtml(parts[p]||'')}" placeholder="${['提取 PDF 文本和表格','当用户要求解析 PDF 时','PDF、扫描件、文本提取'][i]}"></div>`).join('')}</div><span class="hint">最终描述：<span id="description-preview">${escapeHtml(value||'')}</span></span></div>`; }
  if(s.key==='metadata') return `<div class="field wide">${heading}<textarea data-front="metadata" aria-label="metadata" rows="3" placeholder="version: 1.0.0">${escapeHtml(Object.entries(value||{}).map(([k,v])=>`${k}: ${v}`).join('\n'))}</textarea><span class="hint">每行一个 key: value，版本号等信息会写入 SKILL.md。</span></div>`;
  if(s.key==='allowed-tools') {
    const selected=toolRules(value), custom=selected.filter(x=>!knownTools.has(x));
    return `<div class="field wide">${heading}<p class="tool-note">Claude Code 将所选工具在 Skill 调用当轮预批准；这不是工具白名单。</p>${toolSource('claude')}
      ${toolChoices(toolCatalog,selected,'data-allowed-tool')}
      ${custom.length?`<div class="tool-custom"><span>原有自定义规则</span>${custom.map(rule=>`<button class="chip" data-remove-tool="${escapeHtml(rule)}" title="移除此规则">${escapeHtml(rule)} ×</button>`).join('')}</div>`:''}
      <span class="hint">实际工具集合受 Claude Code 版本、平台、模型和设置影响；MCP 工具需先连接服务器。</span></div>`;
  }
  if(s.boolean) return `<div class="field">${heading}<select data-front="${s.key}" aria-label="${s.label}"><option value="">不设置</option><option value="true" ${value===true?'selected':''}>true</option><option value="false" ${value===false?'selected':''}>false</option></select></div>`;
  return `<div class="field ${['when_to_use','paths'].includes(s.key)?'wide':''}">${heading}<input id="front-${s.key}" aria-label="${s.label}" data-front="${s.key}" value="${escapeHtml(value||'')}" placeholder="${escapeHtml(s.example)}"></div>`;
}
function optionalYamlField(spec, frontmatter, variant) {
  const value=frontmatter[spec.key], configured=value!==undefined&&value!==null&&value!==''&&!(typeof value==='object'&&!Object.keys(value).length);
  const open=state.openFields[variant]?.includes(spec.key)?'open':'';
  return `<details class="yaml-optional" data-yaml-field="${spec.key}" ${open}><summary><span>${spec.label}</span><small>${configured?'已配置':'点击展开'}</small><b aria-hidden="true">⌄</b></summary><div class="yaml-optional-body">${fieldSpec(spec,frontmatter,variant,true)}</div></details>`;
}
function renderResourceGroup(category, files) {
  const title={scripts:'scripts',references:'references',assets:'assets'}[category];
  const description={scripts:'确定性脚本',references:'按需读取的知识与规范',assets:'模板、图片和数据文件'}[category];
  const entries=Object.entries(files||{}).filter(([name])=>name.startsWith(`${category}/`));
  return `<section class="resource-group"><div class="resource-group-head"><div><strong>${title}/</strong><small>${description}</small></div><span class="pill gray">${entries.length} 个文件</span></div><div class="stack">${entries.length?entries.map(([name,content])=>resourceRow(name,content)).join(''):'<div class="resource-empty">暂未添加文件</div>'}</div><div class="resource-actions"><button class="btn btn-sm" data-add-resource="${category}">＋ 添加文本</button><button class="btn btn-sm" data-import-resource="${category}">导入文件</button><input data-resource-upload="${category}" type="file" multiple hidden></div></section>`;
}
function renderSkillForm() {
  const d=state.draft;
  const v=d.variants[state.variant]||d.variants.common;
  const specs=state.variant==='claude'?[...standard,...claude]:standard;
  return `<div class="callout"><strong>设计原则</strong> · 一个 Skill 是可发现、按需加载、可复用、可测试的能力包。保持 SKILL.md 为执行导航与核心 SOP，把详细知识放到 references。</div>
  <div class="section-title">基本信息</div><div class="form-grid">${field('显示名称','title',d.title,{required:true})}${field('用途摘要','description',d.description,{placeholder:'用于资产列表展示'})}</div>
  <div class="section-title">YAML front matter</div><div class="toolbar"><p>这里只先显示 name 和 description；其他字段按需展开。${state.variant==='codex'?'Codex 未提供 Skill 级工具预批准，故不显示 allowed-tools。':state.variant==='common'?'通用规范的 allowed-tools 为实验性字段，请在明确支持的 Claude Code 模板中设置。':''}</p><button class="btn btn-sm" id="full-example">查看完整示例</button></div><div class="tabs">${[['common','通用标准'],['claude','Claude Code'],['codex','Codex']].map(([id,label])=>`<button class="tab ${state.variant===id?'active':''}" data-variant="${id}">${label}</button>`).join('')}</div>
  <div class="yaml-primary">${specs.slice(0,2).map(s=>fieldSpec(s,v.frontmatter,state.variant)).join('')}</div><details class="yaml-secondary" id="yaml-secondary" ${state.openYamlGroups[state.variant]?'open':''}><summary class="yaml-secondary-head"><strong>其他 front matter 字段</strong><span class="yaml-group-status">${specs.length-2} 项 · 点击${state.openYamlGroups[state.variant]?'收起':'展开'}</span><b aria-hidden="true">⌄</b></summary><div class="yaml-secondary-body">${specs.slice(2).map(s=>optionalYamlField(s,v.frontmatter,state.variant)).join('')}</div></details>
  <div class="section-title">正文 · 执行导航</div><div class="field"><textarea class="code" id="skill-body" placeholder="Purpose / Core workflow / Input / Output / Verification...">${escapeHtml(v.body||'')}</textarea><span class="hint">建议包含 Purpose、Core workflow、Input、Output、Key Points、Edge cases、Tools/resources、Verification。</span></div>
  <div class="section-title">资源文件</div><div class="small-note">脚本仅保存与部署，不在本助手内执行。支持文本文件和 10 MB 以内的图片、模板、数据文件。</div><div class="resource-groups">${['scripts','references','assets'].map(category=>renderResourceGroup(category,d.files)).join('')}</div>
  <div class="divider"></div><div class="editor-actions"><button class="btn btn-quiet" id="validate-skill">检查 Skill</button><button class="btn" id="preview-skill">预览 SKILL.md</button>${d.id?`<button class="btn" id="review-skill">AI 审查</button><button class="btn" id="improve-skill">AI 改进</button>`:''}</div><div id="validation-result" class="status-line"></div>`;
}
function resourceRow(name,content) { const binary=typeof content!=='string', [category,...parts]=name.split('/'); return `<div class="stack-row resource-row" data-resource-path="${escapeHtml(name)}" data-resource-category="${category}"><span class="path-prefix">${category}/</span><input class="resource-name" aria-label="资源文件名" value="${escapeHtml(parts.join('/'))}" placeholder="文件名"><input class="resource-content" aria-label="资源内容" value="${binary?`二进制文件 · ${Math.floor((content.data||'').length*0.75)} 字节`:escapeHtml(content)}" ${binary?'disabled':''} placeholder="文件内容">${binary?'':`<button class="resource-edit" title="编辑内容">✎</button>`}<button class="resource-remove" title="删除">×</button></div>`; }
function renderWorkflowForm() { const d=state.draft; d.members ||= (d.skillIds||[]).map(skillId=>({skillId,role:''})); return `<div class="form-grid">${field('套件名称','title',d.title,{required:true,wide:true})}${field('用途','description',d.description,{required:true,wide:true,textarea:true,placeholder:'这套 Skills 帮助处理什么任务，适合在什么项目中使用'})}</div><div class="section-title">场景所包含的 Skills</div><p class="small-note">选择成员 Skill，并说明它在套件中的定位和作用。成员之间无需固定执行顺序。</p><div class="stack suite-members" id="flow-list">${d.members.map((member,i)=>flowRow(member,i)).join('')}</div><button class="btn btn-sm" id="add-step" style="margin-top:10px">＋ 添加 Skill</button><div class="callout" style="margin-top:18px">应用到项目时，会一次部署套件里的全部 Skills，并把各自的定位写入项目指令。</div>`; }
function flowRow(member,i) { return `<div class="suite-member"><div class="suite-member-head"><span class="number">${i+1}</span><select class="flow-skill" aria-label="成员 Skill">${options('skill',member.skillId,'选择 Skill')}</select><button class="flow-remove" title="移除这个 Skill" aria-label="移除这个 Skill">×</button></div><label class="field-label" for="suite-role-${i}">在套件中的定位和作用</label><textarea class="flow-role" id="suite-role-${i}" placeholder="例如：先整理输入文件结构；处理文件分析请求时调用">${escapeHtml(member.role||'')}</textarea></div>`; }
function renderPromptForm() { const d=state.draft; return `<div class="form-grid">${field('提示词名称','title',d.title,{required:true})}<div class="field"><label class="field-label">层级</label><select id="scope"><option value="global" ${d.scope==='global'?'selected':''}>通用</option><option value="model" ${d.scope==='model'?'selected':''}>模型</option><option value="software" ${d.scope==='software'?'selected':''}>Harness 框架</option><option value="project" ${d.scope==='project'?'selected':''}>项目</option></select></div><div class="field wide" id="target-wrap">${targetControl(d)}</div>${field('说明','description',d.description,{wide:true})}${field('提示词正文','content',d.content,{wide:true,textarea:true,code:true,required:true})}</div><div class="callout" style="margin-top:19px">组合顺序固定为：通用 → 模型 → Harness 框架 → 项目。同层按名称排序；Agent 也可显式关联提示词。</div>`; }
function targetControl(d) { if(d.scope==='global') return '<span class="small-note">通用层适用于所有组合。</span>'; const choice=d.scope==='model'?`<select id="target">${options('model',d.target)}</select>`:d.scope==='project'?`<select id="target">${options('project',d.target)}</select>`:`<select id="target"><option value="">请选择</option><option value="claude" ${d.target==='claude'?'selected':''}>Claude Code</option><option value="codex" ${d.target==='codex'?'selected':''}>Codex</option></select>`; return `<label class="field-label">适用对象</label>${choice}`; }
function renderAgentForm() { const d=state.draft, harness=d.assetHarness||d.harness||'claude', selected=d.tools||[], unknown=selected.filter(name=>!catalogNames(harness).has(name)); return `<div class="form-grid">${field('Agent 名称','title',d.title,{required:true})}${field('说明','description',d.description)}${field('专属指令','instructions',d.instructions,{wide:true,textarea:true,code:true})}</div><div class="section-title">允许的工具</div>${toolSource(harness)}${toolChoices(catalogFor(harness),selected,'data-agent-tool')}${unknown.length?`<div class="tool-custom"><span>已有自定义工具</span>${unknown.map(name=>`<button class="chip" data-remove-agent-tool="${escapeHtml(name)}" title="移除此项">${escapeHtml(name)} ×</button>`).join('')}</div>`:''}<p class="tool-note">${harness==='claude'?'选中的名称会写入 Claude Code 的 permissions.allow，作为预批准规则。':'Codex 未公开通用的单个 Agent 工具白名单；所选工具会写入 Agent 指令，实际可用性取决于当前运行环境。'}</p><div class="section-title">关联 Skills</div>${checkboxList('skill',d.skillIds||[])}<div class="section-title">关联 Skills 套件</div>${checkboxList('workflow',d.workflowIds||[])}<div class="section-title">额外提示词层</div>${checkboxList('prompt',d.promptIds||[])}<div class="section-title">MCP 服务器</div><div id="mcp-list" class="stack">${(d.mcps||[]).map(mcpRow).join('')}</div><button class="btn btn-sm" id="add-mcp" style="margin-top:10px">＋ 添加 MCP</button>`; }
function checkboxList(type, selected) { const all=state.assets[type]||[]; return all.length?`<div class="chips">${all.map(a=>`<label class="chip"><input type="checkbox" data-link="${type}" value="${a.id}" ${selected.includes(a.id)?'checked':''}> ${escapeHtml(a.title)}</label>`).join('')}</div>`:`<div class="small-note">尚无${labels[type]}，可先到左侧新建。</div>`; }
function mcpRow(m={name:'',command:'',args:[],env:{}}) { return `<div class="stack-row mcp-row" style="display:grid;grid-template-columns:1fr 1fr auto"><input class="mcp-name" value="${escapeHtml(m.name)}" placeholder="名称，如 filesystem"><input class="mcp-command" value="${escapeHtml(m.command)}" placeholder="命令，如 npx"><button class="mcp-remove">×</button><input class="mcp-args" value="${escapeHtml((m.args||[]).join(' '))}" placeholder="参数，以空格分隔"><input class="mcp-env" value="${escapeHtml(Object.entries(m.env||{}).map(([k,v])=>`${k}=${v}`).join('; '))}" placeholder="环境变量 KEY=value; KEY2=value"></div>`; }
function renderProjectForm() { const d=state.draft; return `<div class="form-grid">${field('项目名称','title',d.title,{required:true})}${field('说明','description',d.description,{wide:true,textarea:true})}<div class="field wide"><label class="field-label" for="f-directory">本机项目路径 <span class="pill gray">仅保存在这台电脑</span></label><div class="path-picker"><input id="f-directory" value="${escapeHtml(d.directory||'')}" placeholder="待分配 · 点击右侧选择文件夹" readonly><button class="btn" id="pick-project-directory" type="button">选择文件夹</button>${d.directory?'<button class="btn btn-sm" id="clear-project-directory" type="button">清除</button>':''}</div><span class="hint">选择后自动保存在这台电脑；新项目在保存资产版本时一并记录。只有一键应用时才写入所选目录。</span></div></div><div class="section-title">默认应用的 Skills 套件</div>${checkboxList('workflow',d.suiteIds||[])}<div class="callout" style="margin-top:20px">资产始终保存在用户目录的 Agent_assets_manager。项目路径不上传 GitHub；可稍后再分配。</div>`; }
function renderModelForm() { const d=state.draft; return `<div class="form-grid">${field('配置名称','title',d.title,{required:true})}${field('模型 ID','model',d.model,{required:true,placeholder:'claude-sonnet-4-5'})}${field('Anthropic 协议 API 地址','baseUrl',d.baseUrl,{required:true,wide:true,placeholder:'https://api.anthropic.com'})}<div class="field wide"><label class="field-label">API Key <span class="pill gray">本机私有</span></label><input id="api-key" type="password" value="" autocomplete="new-password" placeholder="${d.hasKey?'已保存；留空表示不修改':'输入 API Key'}"><span class="hint">Key 不进入 Git 版本库，页面不会回显。请只连接你信任的服务地址。</span></div>${field('说明','description',d.description,{wide:true})}</div>`; }
function bindForm(type) {
  const d=state.draft;
  $$('[data-bind]').forEach(el=>el.oninput=()=>{ d[el.dataset.bind]=el.value; if(el.dataset.bind==='title') $('.editor-head h2').textContent=el.value||'未命名'; });
  $('#save-btn').onclick=()=>saveCurrent();
  $('#history-btn')?.addEventListener('click',()=>showHistory(type,d.id));
  $('#delete-btn')?.addEventListener('click',()=>deleteCurrent());
  $('#import-skill')?.addEventListener('click',importExistingSkill);
  $('#import-local-skill')?.addEventListener('click',()=>$('#local-skill-directory').click());
  $('#local-skill-directory')?.addEventListener('change',event=>importLocalSkillDirectory(event.target.files));
  if(profiledTypes.has(type)) {
    const switchProfile=()=>{
      const previous=d.assetHarness&&d.assetModelId?`${d.assetHarness}:${d.assetModelId}`:'';
      const snapshot=profileSnapshot(type,d);
      if(previous) state.profileDrafts[previous]=snapshot;
      state.lastProfileCopy=snapshot;
      const harness=$('#asset-harness').value, modelId=$('#asset-model').value;
      d.assetHarness=harness; d.assetModelId=modelId;
      const key=`${harness}:${modelId}`;
      const target=state.profileDrafts[key]||d.profiles?.[key]||(d.profiles&&Object.keys(d.profiles).length?profileSnapshot(type,emptyDraft(type)):null);
      if(target) for(const field of profileFields[type]) { if(Object.hasOwn(target,field)) d[field]=deep(target[field]); else delete d[field]; }
      if(type==='agent') {d.harness=harness||'claude';d.modelId=modelId;}
      if(type==='prompt'&&d.scope==='model') d.target=modelId;
      if(type==='prompt'&&d.scope==='software') d.target=harness;
      state.variant='common';render();
    };
    $('#asset-harness').onchange=switchProfile;
    $('#asset-model').onchange=switchProfile;
    $('#copy-profile')?.addEventListener('click',()=>{for(const [field,value] of Object.entries(state.lastProfileCopy||{})) d[field]=deep(value);if(type==='agent'){d.harness=d.assetHarness;d.modelId=d.assetModelId;}render();});
  }
  if(type==='skill') bindSkill();
  if(type==='workflow') bindWorkflow();
  if(type==='prompt') bindPrompt();
  if(type==='agent') bindAgent();
  if(type==='project') bindProject();
  if(type==='model') $('#api-key').oninput=e=>d.apiKey=e.target.value;
}
function currentVariant() { return state.draft.variants[state.variant]; }
function ensureVariant(name) { if(!state.draft.variants[name]) { const variant=deep(state.draft.variants.common); if(name==='codex') delete variant.frontmatter['allowed-tools']; state.draft.variants[name]=variant; } }
function copySkillName(name) {
  if(!name) return name;
  const used=new Set((state.assets.skill||[]).flatMap(skill=>Object.values(skill.variants||{}).map(variant=>variant.frontmatter?.name).filter(Boolean)));
  const stem=String(name).replace(/-+$/,'').slice(0,55);
  let candidate=`${stem}-copy`, number=2;
  while(used.has(candidate)) candidate=`${stem.slice(0,53)}-copy-${number++}`;
  return candidate;
}
function importExistingSkill() {
  const skills=state.assets.skill||[];
  if(!skills.length) return showModal('导入已有 Skill','<div class="empty">资产库里还没有 Skill。保存第一个 Skill 后，就可以在新建时复用它的内容。</div>');
  showModal('导入已有 Skill',`<div class="field"><label class="field-label" for="import-skill-source">选择来源</label><select id="import-skill-source">${skills.map(skill=>`<option value="${escapeHtml(skill.id)}">${escapeHtml(skill.title)}</option>`).join('')}</select><span id="import-skill-detail" class="hint"></span></div>
    <div class="section-title">填充到当前草稿的内容</div><div class="import-parts">
    ${[['basic','显示名称与用途摘要'],['yaml','YAML front matter 与 description 模板'],['body','SKILL.md 正文'],['files','scripts / references / assets 资源文件']].map(([key,label])=>`<label class="checkline"><input type="checkbox" data-import-part="${key}" checked><span>${label}</span></label>`).join('')}</div>
    <div class="small-note">导入会替换所选部分的草稿内容；Skill 标识会自动加上 -copy，便于作为新资产保存。</div>
    <div class="modal-footer"><button class="btn btn-primary" id="import-skill-apply">填充编辑器</button></div>`);
  const sourceSelect=$('#import-skill-source');
  const updateDetail=()=>{ const source=skills.find(skill=>skill.id===sourceSelect.value); $('#import-skill-detail').textContent=source?.description||'暂无用途摘要'; };
  sourceSelect.onchange=updateDetail; updateDetail();
  $('#import-skill-apply').onclick=()=>{
    const source=skills.find(skill=>skill.id===sourceSelect.value);
    const parts=new Set($$('[data-import-part]:checked').map(input=>input.dataset.importPart));
    if(!source||!parts.size) return notice('请选择来源和至少一项导入内容。',true);
    const draft=state.draft;
    if(parts.has('basic')) { draft.title=`${source.title}（副本）`; draft.description=source.description||''; }
    const variantNames=parts.has('yaml')?Object.keys(source.variants||{}):Object.keys(draft.variants);
    if(parts.has('yaml')||parts.has('body')) for(const variantName of variantNames) {
      const sourceVariant=source.variants?.[variantName]||source.variants?.common;
      if(!sourceVariant) continue;
      const target=draft.variants[variantName]||deep(draft.variants.common);
      if(parts.has('yaml')) {
        target.frontmatter=deep(sourceVariant.frontmatter||{});
        target.frontmatter.name=copySkillName(target.frontmatter.name);
        target.descriptionParts=deep(sourceVariant.descriptionParts||{what:target.frontmatter.description||'',when:'',keywords:''});
      }
      if(parts.has('body')) target.body=sourceVariant.body||'';
      draft.variants[variantName]=target;
    }
    if(parts.has('files')) draft.files={...draft.files,...deep(source.files||{})};
    state.variant='common'; state.openFields={}; state.openYamlGroups={}; modal.close(); render(); notice('已填充编辑器。请检查内容并保存为新版本。');
  };
}
function importedSkillName(rawName, folderName, warnings) {
  const original=String(rawName||folderName||'imported-skill');
  const base=original.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64).replace(/-+$/,'')||'imported-skill';
  if(base!==original) warnings.push(`name 已从「${original}」调整为「${base}」，请确认。`);
  const used=new Set((state.assets.skill||[]).flatMap(skill=>Object.values(skill.variants||{}).map(variant=>variant.frontmatter?.name).filter(Boolean)));
  let name=base, number=2;
  while(used.has(name)) name=`${base.slice(0,54)}-import-${number++}`;
  if(name!==base) warnings.push(`已有同名 Skill，新资产暂命名为「${name}」。`);
  return name;
}
function normalizeImportedFrontmatter(raw, folderName, warnings) {
  const frontmatter={ name:importedSkillName(raw.name,folderName,warnings), description:typeof raw.description==='string'?raw.description:'' };
  if(raw.description!==undefined&&typeof raw.description!=='string') warnings.push('description 不是文本，请在导入后补充。');
  for(const key of ['license','compatibility']) if(raw[key]!==undefined&&raw[key]!==null) frontmatter[key]=String(raw[key]);
  const metadata={};
  if(raw.metadata&&typeof raw.metadata==='object'&&!Array.isArray(raw.metadata)) for(const [key,value] of Object.entries(raw.metadata)) metadata[key]=String(value);
  else if(raw.metadata!==undefined) warnings.push('metadata 不是键值映射，已使用默认版本号。');
  frontmatter.metadata=Object.keys(metadata).length?metadata:{version:'1.0.0'};
  const claudeFrontmatter={...frontmatter};
  const booleanFields=new Set(['disable-model-invocation','user-invocable']);
  const listFields=new Set(['allowed-tools','disallowed-tools','arguments','paths']);
  for(const spec of claude) {
    const value=raw[spec.key];
    if(value===undefined||value===null) continue;
    if(booleanFields.has(spec.key)) {
      if(typeof value==='boolean') claudeFrontmatter[spec.key]=value;
      else warnings.push(`${spec.key} 不是布尔值，未填入 Claude Code 模板。`);
    } else if(Array.isArray(value)&&listFields.has(spec.key)) claudeFrontmatter[spec.key]=value.map(String).join(spec.key==='paths'?', ':' ');
    else if(typeof value==='string'||typeof value==='number') claudeFrontmatter[spec.key]=String(value);
    else warnings.push(`${spec.key} 的结构暂不支持，未填入编辑器。`);
  }
  return {frontmatter,claudeFrontmatter,hasClaudeFields:claude.some(spec=>raw[spec.key]!==undefined)};
}
async function importLocalSkillDirectory(fileList) {
  if(!fileList?.length) return;
  const files=[...fileList], warnings=[];
  try {
    const paths=files.map(file=>String(file.webkitRelativePath||'').replaceAll('\\','/'));
    if(paths.some(path=>!path.includes('/'))) throw new Error('浏览器没有提供目录内的相对路径，请使用支持目录选择的浏览器');
    const roots=new Set(paths.map(path=>path.split('/')[0]));
    if(roots.size!==1) throw new Error('一次只能导入一个 Skill 包目录');
    const folderName=[...roots][0];
    const index=paths.findIndex(path=>path.split('/').length===2&&path.split('/')[1].toLowerCase()==='skill.md');
    if(index<0) throw new Error('所选目录的根部没有 SKILL.md，请选择单个 Skill 包目录');
    if(files[index].size>512_000) throw new Error('SKILL.md 超过 500 KB');
    const parsed=await api('import-skill','POST',{skillMd:await files[index].text()});
    const normalized=normalizeImportedFrontmatter(parsed.frontmatter,folderName,warnings);
    if(parsed.unknownFields.length) warnings.push(`未识别的 front matter 字段：${parsed.unknownFields.join('、')}。这些字段不会写入新资产。`);
    const resources={}, skipped=[];
    let totalBytes=0;
    for(let i=0;i<files.length;i++) {
      if(i===index) continue;
      const relative=paths[i].split('/').slice(1).join('/');
      if(!/^(scripts|references|assets)\//.test(relative)) { skipped.push(relative); continue; }
      if(!relative||relative.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"|?*\x00-\x1f]/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) { skipped.push(relative); continue; }
      const file=files[i];
      if(file.size>10_000_000) throw new Error(`${relative} 超过单文件 10 MB 上限`);
      totalBytes+=file.size;
      if(totalBytes>12_000_000) throw new Error('资源文件总大小超过 12 MB，请精简目录后重试');
      const isText=file.type.startsWith('text/')||/\.(md|txt|py|js|mjs|cjs|json|ya?ml|sh|ps1|csv|xml|html|css|svg)$/i.test(relative);
      if(isText) resources[relative]=await file.text();
      else {
        const data=await new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=()=>reject(new Error(`读取 ${relative} 失败`)); reader.readAsDataURL(file); });
        resources[relative]={encoding:'base64',data,mime:file.type||'application/octet-stream'};
      }
    }
    if(skipped.length) warnings.push(`未导入 ${skipped.length} 个其他路径的文件：${skipped.slice(0,5).join('、')}${skipped.length>5?' 等':''}。`);
    const defaultTarget=normalized.hasClaudeFields?'claude':'common';
    showModal('从本地目录导入 Skill',`<div class="help-grid"><div><b>目录</b><p>${escapeHtml(folderName)}</p></div><div><b>解析结果</b><p>Skill 名称：${escapeHtml(normalized.frontmatter.name)}<br>description：${escapeHtml(normalized.frontmatter.description||'未填写')}<br>资源文件：${Object.keys(resources).length} 个</p></div></div><div class="field" style="margin-top:14px"><label class="field-label" for="local-import-target">导入后打开的模板</label><select id="local-import-target"><option value="common" ${defaultTarget==='common'?'selected':''}>通用标准</option><option value="claude" ${defaultTarget==='claude'?'selected':''}>Claude Code</option><option value="codex">Codex</option></select></div>${warnings.length?`<div class="callout" style="margin-top:14px"><strong>请检查</strong><br>${warnings.map(escapeHtml).join('<br>')}</div>`:''}<div class="modal-footer"><button class="btn" id="local-import-cancel">取消</button><button class="btn btn-primary" id="local-import-apply">填入新 Skill 草稿</button></div>`);
    $('#local-import-cancel').onclick=()=>modal.close();
    $('#local-import-apply').onclick=()=>{
      const target=$('#local-import-target').value;
      const draft=emptyDraft('skill');
      const descriptionParts={what:normalized.frontmatter.description,when:'',keywords:''};
      draft.title=String(parsed.frontmatter.name||folderName);
      draft.description=normalized.frontmatter.description;
      draft.variants.common={frontmatter:deep(normalized.frontmatter),descriptionParts:deep(descriptionParts),body:parsed.body};
      if(normalized.hasClaudeFields||target==='claude') draft.variants.claude={frontmatter:deep(normalized.claudeFrontmatter),descriptionParts:deep(descriptionParts),body:parsed.body};
      if(target==='codex') draft.variants.codex={frontmatter:deep(normalized.frontmatter),descriptionParts:deep(descriptionParts),body:parsed.body};
      draft.files=resources;
      state.draft=draft; state.variant=target; state.openFields={}; state.openYamlGroups={};
      modal.close(); render(); notice('本地 Skill 已填入草稿；可修改或直接保存 Git 版本。');
    };
  } catch(error) { notice(error.message,true); }
  finally { const input=$('#local-skill-directory'); if(input) input.value=''; }
}
function bindSkill() {
  $$('[data-variant]').forEach(b=>b.onclick=()=>{ ensureVariant(b.dataset.variant); state.variant=b.dataset.variant; render(); });
  $('#yaml-secondary').ontoggle=event=>{ state.openYamlGroups[state.variant]=event.target.open; $('.yaml-group-status',event.target).textContent=`${$$('[data-yaml-field]',event.target).length} 项 · 点击${event.target.open?'收起':'展开'}`; };
  $('#full-example').onclick=()=>showModal(`${state.variant==='claude'?'Claude Code':state.variant==='codex'?'Codex':'通用'} · 完整示例`,`<pre class="markdown-preview">${escapeHtml(skillExample(state.variant))}</pre>`);
  $$('[data-front]').forEach(el=>el.oninput=()=>{ const f=currentVariant().frontmatter; if(el.dataset.front==='metadata') { const map={}; for(const line of el.value.split('\n')) { const at=line.indexOf(':'); if(at>0) map[line.slice(0,at).trim()]=line.slice(at+1).trim(); } f.metadata=map; } else if(['disable-model-invocation','user-invocable'].includes(el.dataset.front)) { if(el.value==='') delete f[el.dataset.front]; else f[el.dataset.front]=el.value==='true'; } else f[el.dataset.front]=el.value; });
  $$('[data-part]').forEach(el=>el.oninput=()=>{ const v=currentVariant(); v.descriptionParts=v.descriptionParts||{}; v.descriptionParts[el.dataset.part]=el.value; v.frontmatter.description=[v.descriptionParts.what,v.descriptionParts.when,v.descriptionParts.keywords?`相关表达：${v.descriptionParts.keywords}`:''].filter(Boolean).join('。').replace(/。。/g,'。'); $('#description-preview').textContent=v.frontmatter.description; });
  $('#skill-body').oninput=e=>currentVariant().body=e.target.value;
  $$('[data-help]').forEach(b=>b.onclick=()=>showHelp(b.dataset.help,b.dataset.helpTag));
  $$('[data-check]').forEach(b=>b.onclick=()=>checkField(b.dataset.check,b));
  $$('[data-yaml-field]').forEach(details=>details.ontoggle=()=>{
    const open=new Set(state.openFields[state.variant]||[]);
    if(details.open) open.add(details.dataset.yamlField); else open.delete(details.dataset.yamlField);
    state.openFields[state.variant]=[...open];
  });
  $$('[data-allowed-tool]').forEach(input=>input.onchange=()=>{
    const previous=toolRules(currentVariant().frontmatter['allowed-tools']);
    const custom=previous.filter(rule=>!knownTools.has(rule));
    const selected=$$('[data-allowed-tool]:checked').map(item=>item.dataset.allowedTool);
    currentVariant().frontmatter['allowed-tools']=[...selected,...custom].join(' ');
  });
  $$('[data-remove-tool]').forEach(button=>button.onclick=()=>{
    currentVariant().frontmatter['allowed-tools']=toolRules(currentVariant().frontmatter['allowed-tools']).filter(rule=>rule!==button.dataset.removeTool).join(' ');
    render();
  });
  bindResources();
  $$('[data-add-resource]').forEach(button=>button.onclick=()=>{
    const category=button.dataset.addResource;
    const extension=category==='scripts'?'js':'md';
    let number=1, key;
    do { key=`${category}/new-${number++}.${extension}`; } while(Object.hasOwn(state.draft.files,key));
    state.draft.files[key]='';
    render();
    $(`.resource-row[data-resource-path="${key}"] .resource-name`)?.focus();
  });
  $$('[data-import-resource]').forEach(button=>button.onclick=()=>$(`[data-resource-upload="${button.dataset.importResource}"]`).click());
  $$('[data-resource-upload]').forEach(input=>input.onchange=async event=>{
    try {
      const category=input.dataset.resourceUpload;
      for(const file of event.target.files) {
        if(file.size>10_000_000) throw new Error(`${file.name} 超过 10 MB 上限`);
        const clean=file.name.replace(/[^\w.\-]/g,'-');
        let key=`${category}/${clean}`;
        if(Object.hasOwn(state.draft.files,key)) { let number=2; const dot=clean.lastIndexOf('.'); const stem=dot>0?clean.slice(0,dot):clean, ext=dot>0?clean.slice(dot):''; do { key=`${category}/${stem}-${number++}${ext}`; } while(Object.hasOwn(state.draft.files,key)); }
        const isText=file.type.startsWith('text/')||/\.(md|txt|py|js|mjs|cjs|json|ya?ml|sh|ps1|csv|xml|html|css|svg)$/i.test(clean);
        if(isText) state.draft.files[key]=await file.text();
        else {
          const data=await new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=()=>reject(new Error('读取文件失败')); reader.readAsDataURL(file); });
          state.draft.files[key]={encoding:'base64',data,mime:file.type||'application/octet-stream'};
        }
      }
      render(); notice('文件已加入对应资源分组，请保存 Git 版本。');
    } catch(error) { notice(error.message,true); }
  });
  $('#validate-skill').onclick=async()=>{ try { const result=await api('validate','POST',{variant:currentVariant(),software:state.variant}); $('#validation-result').textContent=result.issues.length?`需修改：${result.issues.join('；')}`:'✓ 基础格式检查通过'; $('#validation-result').style.color=result.issues.length?'#b95d65':'#348f75'; } catch(e){notice(e.message,true);} };
  $('#preview-skill').onclick=async()=>{ try { const result=await api('validate','POST',{variant:currentVariant(),software:state.variant}); showModal('SKILL.md 预览',`<pre class="markdown-preview">${escapeHtml(result.markdown)}</pre>`); } catch(e){notice(e.message,true);} };
  $('#review-skill')?.addEventListener('click',()=>aiDialog('review'));
  $('#improve-skill')?.addEventListener('click',()=>aiDialog('improve'));
}
function bindResources() {
  $$('.resource-row').forEach(row=>{
    const path=()=>row.dataset.resourcePath;
    $('.resource-name',row).onchange=e=>{
      const old=path(), name=e.target.value.trim().replace(/\\/g,'/');
      if(!name||!/^[A-Za-z0-9_./-]+$/.test(name)||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..')) { e.target.value=old.slice(row.dataset.resourceCategory.length+1); return notice('请输入英文、数字、点、连字符或斜杠组成的相对路径。',true); }
      const next=`${row.dataset.resourceCategory}/${name}`;
      if(next!==old&&Object.hasOwn(state.draft.files,next)) { e.target.value=old.slice(row.dataset.resourceCategory.length+1); return notice('该资源文件名已存在。',true); }
      const content=state.draft.files[old]; delete state.draft.files[old]; state.draft.files[next]=content; render();
    };
    $('.resource-content',row).oninput=e=>{ state.draft.files[path()]=e.target.value; };
    $('.resource-edit',row)?.addEventListener('click',()=>{ const name=path(), content=state.draft.files[name]; showModal(`编辑 ${name}`,`<textarea id="resource-large" class="code" style="width:100%;min-height:290px">${escapeHtml(content)}</textarea><div class="modal-footer"><button class="btn btn-primary" id="resource-done">完成</button></div>`); $('#resource-done').onclick=()=>{state.draft.files[name]=$('#resource-large').value;modal.close();render();}; });
    $('.resource-remove',row).onclick=()=>{ delete state.draft.files[path()]; render(); };
  });
}
function showHelp(key,tag) { const s=fields.find(x=>x.key===key); const value={ '作用':s.purpose, '最佳实践':s.practice, '例子':s.example }[tag]; showModal(`${s.label} · ${tag}`,`<div class="help-grid"><div>${escapeHtml(value)}</div></div>`); }
function checkField(key,button) { const s=fields.find(x=>x.key===key),v=currentVariant().frontmatter[key]; let okay=state.variant==='claude'&&s.required&&!v?true:s.check?s.check(v):true; if(key==='metadata') okay=!v||Object.values(v).every(x=>typeof x==='string'); button.classList.toggle('fail',!okay); button.textContent=okay?'✓ 通过':'! 需修改'; notice(okay?`${key} 检查通过`:`${key} 不符合要求：${s.practice}`,!okay); }
function skillExample(software) { const extra=software==='claude'?`when_to_use: "用户提到扫描件、发票 OCR 或导出 PDF 表格时"
argument-hint: "[file] [format]"
arguments: "file format"
disable-model-invocation: false
user-invocable: true
disallowed-tools: ""
model: "inherit"
effort: "high"
context: "fork"
agent: "Explore"
paths: "docs/**/*.pdf"
shell: "powershell"
`:''; return `---
name: pdf-extraction
description: "提取 PDF 文本和表格。当用户要求解析 PDF、读取扫描件或导出表格时使用。相关表达：PDF、OCR、表格提取。"
license: "Apache-2.0"
compatibility: "Requires Python 3.11+ and network access"
metadata:
  version: "1.0.0"
  author: "team"
${software==='claude'?'allowed-tools: "Read Grep"\n':''}${extra}---

## Purpose / Overview
从 PDF 提取可核验的文本和表格。

## Core workflow
1. 确认输入文件及目标格式。
2. 按需读取 references/guide.md，再运行 scripts/extract.py。
3. 检查提取结果并返回文件路径。

## Input
PDF 文件与输出格式。

## Output
提取后的文本、表格和检查结果。

## Key Points
保留页码与表格边界。

## Edge cases
扫描件先执行 OCR；加密文件请求用户提供可读版本。

## Tools / resources
需要格式规则时读取 references/guide.md；确定性提取时运行 scripts/extract.py。

## Verification
确认输出非空，页数与输入一致，并抽查一页内容。`; }
function bindWorkflow() { const d=state.draft; d.members ||= (d.skillIds||[]).map(skillId=>({skillId,role:''})); $('#add-step').onclick=()=>{d.members.push({skillId:'',role:''});render();}; $$('.suite-member').forEach((row,i)=>{ $('.flow-skill',row).onchange=e=>d.members[i].skillId=e.target.value; $('.flow-role',row).oninput=e=>d.members[i].role=e.target.value; $('.flow-remove',row).onclick=()=>{d.members.splice(i,1);render();}; }); }
function bindProject() {
  $$('[data-link="workflow"]').forEach(input=>input.onchange=()=>{state.draft.suiteIds=$$('[data-link="workflow"]:checked').map(item=>item.value);});
  $('#pick-project-directory').onclick=async()=>{
    const button=$('#pick-project-directory');button.disabled=true;button.textContent='等待选择…';
    const draft=state.draft;
    try {
      const result=await api('pick-directory','POST',{initial:draft.directory||''});
      if(!result.directory||state.draft!==draft||state.section!=='project') return;
      draft.directory=result.directory;
      if(draft.id) {
        const project=await api(`project/${draft.id}/local-path`,'POST',{directory:result.directory});
        state.assets.project=state.assets.project.map(item=>item.id===project.id?project:item);
        notice('已选择并保存本机项目路径。');
      } else notice('已选择文件夹；保存项目版本后即可使用。');
      render();
    } catch(error) { notice(error.message,true); }
    finally { if(button.isConnected){button.disabled=false;button.textContent='选择文件夹';} }
  };
  $('#clear-project-directory')?.addEventListener('click',async()=>{try{if(state.draft.id){const project=await api(`project/${state.draft.id}/local-path`,'POST',{directory:''});state.assets.project=state.assets.project.map(item=>item.id===project.id?project:item);}state.draft.directory='';render();notice('本机项目路径已清除。');}catch(error){notice(error.message,true);}});
}
function bindPrompt() { $('#scope').onchange=e=>{state.draft.scope=e.target.value;state.draft.target='';render();}; $('#target')?.addEventListener('change',e=>state.draft.target=e.target.value); }
function bindAgent() {
  const d=state.draft;
  d.harness=d.assetHarness||d.harness||'claude';
  d.modelId=d.assetModelId||d.modelId||'';
  $$('[data-agent-tool]').forEach(input=>input.onchange=()=>{ const custom=(d.tools||[]).filter(name=>!catalogNames(d.harness).has(name)); d.tools=[...$$('[data-agent-tool]:checked').map(item=>item.dataset.agentTool),...custom]; });
  $$('[data-remove-agent-tool]').forEach(button=>button.onclick=()=>{ d.tools=d.tools.filter(name=>name!==button.dataset.removeAgentTool); render(); });
  $$('[data-link]').forEach(el=>el.onchange=()=>{const key={skill:'skillIds',workflow:'workflowIds',prompt:'promptIds'}[el.dataset.link];d[key]=$$(`[data-link="${el.dataset.link}"]:checked`).map(x=>x.value);});
  $('#add-mcp').onclick=()=>{d.mcps.push({name:'',command:'',args:[],env:{}});render();};
  $$('.mcp-row').forEach((row,i)=>{for(const key of ['name','command','args','env']) $(`.mcp-${key}`,row).oninput=e=>{if(key==='args')d.mcps[i].args=e.target.value.split(/\s+/).filter(Boolean);else if(key==='env'){const env={};for(const pair of e.target.value.split(';')){const at=pair.indexOf('=');if(at>0)env[pair.slice(0,at).trim()]=pair.slice(at+1).trim();}d.mcps[i].env=env;}else d.mcps[i][key]=e.target.value;}; $('.mcp-remove',row).onclick=()=>{d.mcps.splice(i,1);render();}; });
}
async function saveCurrent() { try { const d=state.draft; if(profiledTypes.has(state.section)&&(!d.assetHarness||!d.assetModelId)) throw new Error('请同时选择 Harness 框架和模型版本'); const message=await askVersionMessage('保存资产版本'); if(message===null)return; const asset=await api(state.section,'POST',{asset:d,message}); state.selected=asset.id; await refresh(); state.draft=deep(asset); state.profileDrafts={};state.lastProfileCopy=null; render(); notice(`已保存 Git 版本：${message}`); } catch(e){notice(e.message,true);} }
async function deleteCurrent() { if(!await askConfirm('删除资产',`确定删除「${state.draft.title}」？此操作仍可通过 Git 历史恢复。`))return; const message=await askVersionMessage('记录删除原因'); if(message===null)return; try{await api(`${state.section}/${state.draft.id}`,'DELETE',{message});state.draft=null;state.selected=null;await refresh();notice('资产已删除并记录 Git 版本。');}catch(e){notice(e.message,true);} }
function showModal(title,html) { $('#modal-title').textContent=title;$('#modal-body').innerHTML=html;if(!modal.open)modal.showModal(); }
function modalAnswer(title,body,submitText,readValue) {
  return new Promise(resolve=>{
    showModal(title,`${body}<div class="modal-footer"><button class="btn" id="dialog-cancel">取消</button><button class="btn btn-primary" id="dialog-submit">${submitText}</button></div>`);
    let settled=false;
    const onClose=()=>{ if(!settled) { settled=true; resolve(null); } };
    modal.addEventListener('close',onClose,{once:true});
    const finish=value=>{ if(settled)return; settled=true; modal.removeEventListener('close',onClose); modal.close(); resolve(value); };
    $('#dialog-cancel').onclick=()=>finish(null);
    $('#dialog-submit').onclick=()=>{ const result=readValue(); if(result!==undefined) finish(result); };
    $('#version-message-input')?.addEventListener('keydown',event=>{ if(event.key==='Enter') { event.preventDefault(); $('#dialog-submit').click(); } });
    $('#version-message-input')?.focus();
  });
}
function askVersionMessage(title) {
  return modalAnswer(title,`<div class="field"><label class="field-label" for="version-message-input">Git 版本说明 <span class="pill">必填</span></label><input id="version-message-input" maxlength="200" placeholder="例如：完善 Skill 的触发说明"><span class="hint">至少 3 个字；这条说明会显示在版本历史中。</span><span id="version-message-error" class="dialog-error" role="alert"></span></div>`,'保存版本',()=>{
    const message=$('#version-message-input').value.trim();
    if(message.length<3) { $('#version-message-error').textContent='版本说明至少需要 3 个字。'; return undefined; }
    return message;
  });
}
function askConfirm(title,message) { return modalAnswer(title,`<p class="dialog-message">${escapeHtml(message)}</p>`,'确认',()=>true); }
$('#modal-close').onclick=()=>modal.close(); modal.addEventListener('click',e=>{if(e.target===modal)modal.close();});
async function showHistory(type,id) {
  try {
    const entries=await api(`${type}/${id}/history`);
    const current=(state.assets[type]||[]).find(item=>item.id===id);
    showModal('版本历史',`<p class="small-note">选择历史版本只改变这台电脑当前使用的内容，不创建 Git 提交。编辑后点击「保存版本」，只会生成一个新提交。</p><div class="history">${entries.length?entries.map(entry=>`<div class="history-row"><div class="history-top"><strong>${escapeHtml(entry.message)}</strong><span class="scope-path">${entry.short}</span></div><p>${new Date(entry.date).toLocaleString('zh-CN')}</p><div class="buttons"><button class="btn btn-sm" data-diff="${entry.hash}">查看差异</button><button class="btn btn-sm btn-quiet" data-select-version="${entry.hash}">${current?.activeVersion===entry.hash?'正在使用':'在本机使用'}</button></div></div>`).join(''):'暂无历史'}</div><div class="modal-footer"><button class="btn" id="select-latest-version">使用最新版本</button></div>`);
    $$('[data-diff]').forEach(button=>button.onclick=async()=>{
      try { const result=await api(`${type}/${id}/diff?hash=${button.dataset.diff}`); showModal('与上个版本的差异',`<pre class="diff">${escapeHtml(result.diff||'此版本无文本差异')}</pre><div class="modal-footer"><button class="btn" id="back-history">返回历史</button></div>`); $('#back-history').onclick=()=>showHistory(type,id); } catch(error) { notice(error.message,true); }
    });
    $$('[data-select-version]').forEach(button=>button.onclick=async()=>{try{await api(`${type}/${id}/select-version`,'POST',{hash:button.dataset.selectVersion});modal.close();await refresh();selectAsset(id);notice('已在本机使用所选历史版本；尚未创建新提交。');}catch(error){notice(error.message,true);}});
    $('#select-latest-version').onclick=async()=>{try{await api(`${type}/${id}/select-version`,'POST',{});modal.close();await refresh();selectAsset(id);notice('已在本机使用最新版本。');}catch(error){notice(error.message,true);}};
  } catch(error) { notice(error.message,true); }
}
async function showTrash(type) {
  try {
    const items=await api(`trash?type=${type}`);
    showModal('已删除的'+labels[type],items.length?`<div class="history">${items.map(item=>`<div class="history-row"><div class="history-top"><strong>${escapeHtml(item.title)}</strong><span class="scope-path">${escapeHtml(item.id.slice(0,8))}</span></div><div class="buttons"><button class="btn btn-sm btn-quiet" data-recover="${item.id}" data-hash="${item.hash}">恢复资产</button></div></div>`).join('')}</div>`:'<div class="empty">没有已删除的资产。</div>');
    $$('[data-recover]').forEach(button=>button.onclick=async()=>{
      const message=await askVersionMessage('记录恢复原因'); if(message===null)return;
      try { await api(`${type}/${button.dataset.recover}/restore`,'POST',{hash:button.dataset.hash,message}); modal.close(); await refresh(); selectAsset(button.dataset.recover); notice('资产已恢复并创建新 Git 版本。'); } catch(error) { notice(error.message,true); }
    });
  } catch(error) { notice(error.message,true); }
}
function aiDialog(mode) { const models=state.assets.model||[]; if(!models.length)return notice('请先在「模型服务」配置 Anthropic 协议模型。',true); showModal(mode==='review'?'Skill 审查':'Skill 改进',`<div class="form-grid"><div class="field wide"><label class="field-label">使用模型</label><select id="ai-model">${options('model','', '请选择模型')}</select></div>${mode==='improve'?`<div class="field wide"><label class="field-label">遇到的问题</label><textarea id="ai-problem" placeholder="例如：用户要求处理扫描件时没有触发这个 Skill"></textarea></div>`:''}</div><div class="modal-footer"><button class="btn btn-primary" id="ai-run">${mode==='review'?'开始审查':'生成改进建议'}</button></div><div id="ai-output"></div>`); $('#ai-run').onclick=async()=>{const modelId=$('#ai-model').value;if(!modelId)return notice('请选择模型',true);const button=$('#ai-run');button.disabled=true;button.textContent='模型处理中…';try{const result=await api(`ai/${mode}`,'POST',{skillId:state.draft.id,software:state.variant,modelId,problem:$('#ai-problem')?.value});$('#ai-output').innerHTML=`<div class="section-title">${mode==='review'?'审查意见':'改进建议'}</div><div class="ai-result">${escapeHtml(result.proposal?.summary||result.text)}</div>${result.proposal?.frontmatter&&result.proposal?.body?'<div class="modal-footer"><button class="btn btn-primary" id="apply-proposal">应用到编辑器</button></div>':''}`;$('#apply-proposal')?.addEventListener('click',()=>{state.draft.variants[state.variant].frontmatter=result.proposal.frontmatter;state.draft.variants[state.variant].body=result.proposal.body;state.draft.variants[state.variant].descriptionParts={what:result.proposal.frontmatter.description||'',when:'',keywords:''};modal.close();render();notice('建议已放入编辑器。请检查并保存 Git 版本。');});}catch(e){notice(e.message,true);}finally{button.disabled=false;button.textContent=mode==='review'?'开始审查':'生成改进建议';}}; }
function renderSettings() { const d=state.draft; $('#content').innerHTML=`<div class="intro"><div><h2>审查与改进系统提示词</h2><p>这两段指令会作为模型调用的 system 内容，可按你的团队标准修改。</p></div></div><div class="panel editor"><div class="editor-head"><div><h2>模型审查规则</h2><p>所有修改都要求 Git 版本说明</p></div><button class="btn btn-primary" id="settings-save">保存版本</button></div><div class="form-grid">${field('审查系统提示词','reviewSystem',d.reviewSystem,{wide:true,textarea:true,code:true})}${field('改进系统提示词','improveSystem',d.improveSystem,{wide:true,textarea:true,code:true})}</div>${d.id?'<button class="btn btn-sm" id="settings-history" style="margin-top:18px">版本历史</button>':''}</div>`; $$('[data-bind]').forEach(el=>el.oninput=e=>d[el.dataset.bind]=e.target.value); $('#settings-save').onclick=async()=>{const message=await askVersionMessage('保存审查配置');if(message===null)return;try{const saved=await api('settings','POST',{asset:d,message});state.draft=deep(saved);await refresh();notice('审查规则已保存。');}catch(e){notice(e.message,true);}};$('#settings-history')?.addEventListener('click',()=>showHistory('settings',d.id)); }
function uiProfile(item,software,modelId) { if(!item) return null; if(!item.profiles||!Object.keys(item.profiles).length) return item; const profile=item.profiles[`${software}:${modelId}`]; return profile?{...item,...profile}:null; }
function deployCheckboxList(type,selected,software,modelId) { const all=(state.assets[type]||[]).filter(item=>uiProfile(item,software,modelId)); return all.length?`<div class="chips">${all.map(item=>`<label class="chip"><input type="checkbox" data-link="${type}" value="${item.id}" ${selected.includes(item.id)?'checked':''}> ${escapeHtml(item.title)}</label>`).join('')}</div>`:'<div class="small-note">这个组合尚无可用资产。</div>'; }
function deployAgentOptions(selected,software,modelId) { const all=(state.assets.agent||[]).filter(item=>uiProfile(item,software,modelId)); return `<option value="">不指定 Agent</option>${all.map(item=>`<option value="${item.id}" ${item.id===selected?'selected':''}>${escapeHtml(item.title)}</option>`).join('')}`; }
function deployPromptCandidates() {
  const projectId=$('#deploy-project').value, software=$('#deploy-software').value, modelId=$('#deploy-model').value;
  return (state.assets.prompt||[]).map(item=>uiProfile(item,software,modelId)).filter(Boolean).filter(item=>item.scope==='global'||(item.scope==='project'&&item.target===projectId)||(item.scope==='model'&&item.target===modelId)||(item.scope==='software'&&item.target===software));
}
function renderDeployPromptChoices(selectedIds) {
  const candidates=deployPromptCandidates();
  const selected=new Set(selectedIds??candidates.map(item=>item.id));
  const groups=[['global','通用'],['project','针对项目'],['model','针对模型'],['software','针对 Harness 框架']];
  $('#deploy-prompt-list').innerHTML=groups.map(([scope,label])=>{
    const items=candidates.filter(item=>item.scope===scope);
    return `<div class="deploy-prompt-group"><strong>${label}</strong>${items.length?`<div class="chips">${items.map(item=>`<label class="chip" title="${escapeHtml(item.description||item.title)}"><input type="checkbox" data-deploy-prompt value="${escapeHtml(item.id)}" ${selected.has(item.id)?'checked':''}> ${escapeHtml(item.title)}</label>`).join('')}</div>`:`<small>${scope==='model'&&!$('#deploy-model').value?'先选择目标模型，或新建模型提示词':'当前没有匹配的提示词'}</small>`}</div>`;
  }).join('');
  $$('[data-deploy-prompt]').forEach(input=>input.onchange=()=>{ $('#deploy-result').innerHTML=''; updateDeployAvailability(); });
  updateDeployAvailability();
}
function updateDeployAvailability() {
  const software=$('#deploy-software').value, modelId=$('#deploy-model').value;
  const suites=$$('[data-link="workflow"]:checked').map(input=>input.value);
  const direct=$$('[data-link="skill"]:checked').map(input=>input.value);
  const agent=uiProfile((state.assets.agent||[]).find(item=>item.id===$('#deploy-agent').value),software,modelId);
  const suiteAssets=(state.assets.workflow||[]).filter(item=>[...suites,...(agent?.workflowIds||[])].includes(item.id)).map(item=>uiProfile(item,software,modelId)).filter(Boolean);
  const suiteSkillIds=suiteAssets.flatMap(item=>(item.members||((item.skillIds||[]).map(skillId=>({skillId})))).map(member=>member.skillId));
  const allIds=[...direct,...(agent?.skillIds||[]),...suiteSkillIds];
  const unique=new Set(allIds);
  $('#deploy-skill-summary').textContent=`最终部署 ${unique.size} 个不重复的 Skill${allIds.length>unique.size?`；已去除 ${allIds.length-unique.size} 次重复选择`:''}。`;
  const project=(state.assets.project||[]).find(item=>item.id===$('#deploy-project').value);
  $('#deploy-path-hint').textContent=project&&!project.directory?'该项目尚未分配本机路径。请到「项目」中选择本机目录。':project?.directory?`本机目标：${project.directory}`:'先选择目标项目。';
  $('#deploy-preview').disabled=!project?.directory||!modelId||(!agent&&!unique.size&&!$$('[data-deploy-prompt]:checked').length);
}
function renderDeploy() {
  const projects=state.assets.project||[], agents=state.assets.agent||[];
  const chosenProject=projects.find(project=>project.id===state.deployment?.projectId);
  const chosenAgent=agents.find(agent=>agent.id===state.deployment?.agentId);
  const selectedSuites=state.deployment?.suiteIds??chosenProject?.suiteIds??[];
  const software=state.deployment?.software||'claude', modelId=state.deployment?.modelId||chosenAgent?.modelId||'';
  $('#content').innerHTML=`<div class="intro"><div><h2>组合并应用 Agent 资产</h2><p>选择目标项目与软件，再组合 Agent、单个 Skills、Skills 套件和系统提示词。预览确认后生效。</p></div></div>
    <div class="panel editor"><div class="form-grid">
      <div class="field"><label class="field-label" for="deploy-project">目标项目</label><select id="deploy-project">${options('project',state.deployment?.projectId)}</select><span class="hint" id="deploy-path-hint"></span></div>
      <div class="field"><label class="field-label" for="deploy-software">Harness 框架 <span class="pill">必选</span></label><select id="deploy-software"><option value="claude" ${software==='claude'?'selected':''}>Claude Code</option><option value="codex" ${software==='codex'?'selected':''}>Codex</option></select></div>
      <div class="field"><label class="field-label" for="deploy-model">模型版本 <span class="pill">必选</span></label><select id="deploy-model">${options('model',modelId)}</select></div>
      <div class="field"><label class="field-label" for="deploy-agent">Agent（可选）</label><select id="deploy-agent">${deployAgentOptions(state.deployment?.agentId,software,modelId)}</select></div>
    </div>
    <div class="section-title">Skills</div><div class="deploy-asset-group"><strong>单个 Skills</strong>${deployCheckboxList('skill',state.deployment?.skillIds||[],software,modelId)}</div>
    <div class="deploy-asset-group"><strong>Skills 套件</strong>${deployCheckboxList('workflow',selectedSuites,software,modelId)}</div>
    <p class="small-note" id="deploy-skill-summary"></p>
    <div class="section-title">系统提示词</div>
    <div id="deploy-prompt-list" class="deploy-prompt-list"></div><p class="small-note">按通用 → 模型 → Harness 框架 → 项目的顺序组合；只应用勾选的提示词。组合文档会写入项目，并同步到目标软件的项目指令。</p>
    <div class="quick-links"><button class="btn" id="compose-preview">预览系统提示词</button><button class="btn btn-primary" id="deploy-preview">预览生效内容</button></div>
    <div class="small-note" style="margin-top:13px">目标目录需已存在。同一个 Skill 即使从套件和单独选择中重复出现，也只部署一次。</div><div id="deploy-result"></div></div>`;
  const invalidate=()=>{ $('#deploy-result').innerHTML=''; updateDeployAvailability(); };
  $('#deploy-project').onchange=event=>{ const project=projects.find(item=>item.id===event.target.value); $$('[data-link="workflow"]').forEach(input=>input.checked=(project?.suiteIds||[]).includes(input.value)); renderDeployPromptChoices(); invalidate(); };
  $('#deploy-software').onchange=()=>{state.deployment=deployValues();state.deployment.agentId='';renderDeploy();};
  $('#deploy-agent').onchange=()=>{ renderDeployPromptChoices(); invalidate(); };
  $('#deploy-model').onchange=()=>{state.deployment=deployValues();state.deployment.agentId='';renderDeploy();};
  $$('[data-link="workflow"], [data-link="skill"]').forEach(input=>input.onchange=invalidate);
  renderDeployPromptChoices(state.deployment?.promptIds);
  updateDeployAvailability();
  $('#deploy-preview').onclick=()=>previewDeploy();
  $('#compose-preview').onclick=async()=>{ const values=deployValues(); try { const result=await api('compose','POST',values); const file=`.agent-asset-manager/${values.software}-system-prompt.md`; const target=values.software==='claude'?'CLAUDE.md':'AGENTS.md'; $('#deploy-result').innerHTML=`<div class="section-title">系统提示词组合 · ${result.layers.length} 层</div><div class="chips">${result.layers.map(item=>`<span class="chip">${escapeHtml(item.scope)} · ${escapeHtml(item.title)}</span>`).join('')}</div><p class="small-note">组合文档：${file}；生效后同步写入 ${target}。</p><pre class="markdown-preview" style="margin-top:12px">${escapeHtml(result.text||'尚未选择系统提示词。')}</pre>`; } catch(error) { notice(error.message,true); } };
}
function deployValues() { return {projectId:$('#deploy-project').value,agentId:$('#deploy-agent').value,software:$('#deploy-software').value,modelId:$('#deploy-model').value,skillIds:$$('[data-link="skill"]:checked').map(input=>input.value),suiteIds:$$('[data-link="workflow"]:checked').map(input=>input.value),promptIds:$$('[data-deploy-prompt]:checked').map(input=>input.value)}; }
async function previewDeploy() { const values=deployValues(); state.deployment=values; try{const result=await api('deploy','POST',{...values,preview:true});$('#deploy-result').innerHTML=`<div class="section-title">将写入 ${result.files.length} 个文件${result.removals?.length?`，移除 ${result.removals.length} 个旧文件`:''}</div><div class="preview-list">${result.files.map(x=>`<details class="preview-file"><summary>${escapeHtml(x.path)}</summary><pre>${escapeHtml(x.content)}</pre></details>`).join('')}${(result.removals||[]).map(x=>`<div class="preview-file" style="padding:10px 12px;color:#b55e65;font-size:11px">移除旧文件：${escapeHtml(x)}</div>`).join('')}</div><div class="quick-links"><button class="btn btn-primary" id="deploy-apply">确认生效</button></div>`;$('#deploy-apply').onclick=async()=>{if(!await askConfirm('确认应用资产',`确认将 ${result.files.length} 个文件写入「${result.project}」？`))return;try{const applied=await api('deploy','POST',{...values,preview:false});notice(`已生效：写入 ${applied.files.length} 个文件。`);$('#deploy-result').insertAdjacentHTML('beforeend','<div class="callout" style="margin-top:15px">配置已写入目标项目。请在 Claude Code 或 Codex 中重新加载项目。</div>');}catch(e){notice(e.message,true);}};}catch(e){notice(e.message,true);} }
function renderSync() {
  const sync=state.sync||{}, conflicts=sync.conflicts||[];
  const summary=sync.connected?(sync.conflict?'有待处理的同步冲突':sync.ahead&&sync.behind?`本机待上传 ${sync.ahead} 次，远程待下载 ${sync.behind} 次`:sync.ahead?`本机待上传 ${sync.ahead} 次`:sync.behind?`远程待下载 ${sync.behind} 次`:'已连接；可点击同步检查远程更新'):'尚未连接 GitHub 仓库';
  $('#content').innerHTML=`<div class="intro"><div><h2>GitHub 远程同步</h2><p>一个仓库保存全部资产和完整版本历史。新电脑连接同一仓库后，资产会载入本机。</p></div></div><div class="panel editor"><div class="section-title">本机资产库</div><p class="small-note">${escapeHtml(sync.dataRoot||'')}</p><div class="section-title">连接 GitHub 仓库</div><div class="field wide"><label class="field-label" for="sync-url">仓库地址</label><input id="sync-url" value="${escapeHtml(sync.url||'')}" placeholder="https://github.com/用户名/仓库名.git"><span class="hint">建议使用私有仓库。首次连接时可能需要完成 GitHub 授权；凭据由 Git 管理，本助手不保存令牌。</span></div><div class="quick-links"><button class="btn" id="sync-connect">${sync.connected?'更新连接':'连接并载入'}</button><button class="btn btn-primary" id="sync-run" ${!sync.connected||sync.conflict?'disabled':''}>一键同步</button></div><div class="callout" style="margin-top:18px"><strong>同步状态</strong> · ${escapeHtml(summary)}${sync.connected?`<br><small>分支：${escapeHtml(sync.branch)}</small>`:''}</div>${conflicts.length?`<div class="section-title">处理冲突</div><p class="small-note">两台电脑修改了同一资产。逐项选择要保留的内容，再完成合并；选择不会删除另一边的历史提交。</p><div class="history">${conflicts.map((item,i)=>`<div class="history-row"><strong>${escapeHtml(item.title)}</strong><small class="scope-path">${escapeHtml(item.path)}</small><div class="form-grid" style="margin-top:10px"><label class="chip"><input type="radio" name="conflict-${i}" value="local" data-conflict-path="${escapeHtml(item.path)}"> 保留本机</label><label class="chip"><input type="radio" name="conflict-${i}" value="remote" data-conflict-path="${escapeHtml(item.path)}"> 保留远程</label></div><details class="preview-file"><summary>查看两边内容</summary><div class="form-grid"><div><strong>本机</strong><pre class="diff">${escapeHtml(item.local||'此版本已删除')}</pre></div><div><strong>远程</strong><pre class="diff">${escapeHtml(item.remote||'此版本已删除')}</pre></div></div></details></div>`).join('')}</div><button class="btn btn-primary" id="sync-resolve">完成冲突处理并同步</button>`:''}<p class="small-note" style="margin-top:18px">项目在新电脑上会显示“待分配本机路径”；模型 API Key 和 MCP 环境变量需在该电脑单独填写。</p></div>`;
  $('#sync-connect').onclick=async()=>{const url=$('#sync-url').value.trim();if(!url)return notice('请填写 GitHub 仓库地址。',true);const button=$('#sync-connect');button.disabled=true;button.textContent='正在连接…';try{state.sync=await api('sync/connect','POST',{url});await refresh();notice('仓库已连接；远程资产已载入或可继续同步。');}catch(error){notice(error.message,true);button.disabled=false;button.textContent='连接并载入';}};
  $('#sync-run').onclick=async()=>{const button=$('#sync-run');button.disabled=true;button.textContent='正在同步…';try{state.sync=await api('sync/run','POST',{});await refresh();notice(state.sync.conflicts?.length?'请处理同步冲突。':'资产与 GitHub 已同步。');}catch(error){notice(error.message,true);button.disabled=false;button.textContent='一键同步';}};
  $('#sync-resolve')?.addEventListener('click',async()=>{const choices={};$$('[data-conflict-path]:checked').forEach(input=>choices[input.dataset.conflictPath]=input.value);if(Object.keys(choices).length!==conflicts.length)return notice('请为每项冲突选择本机或远程版本。',true);try{state.sync=await api('sync/resolve','POST',{choices});await refresh();notice('冲突已解决，资产与 GitHub 已同步。');}catch(error){notice(error.message,true);}});
}
refresh().catch(e=>notice(e.message,true));
