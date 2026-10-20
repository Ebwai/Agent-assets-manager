import { showVersionDiff } from './version-diff.js';
export function pluginUI({api,escapeHtml:e,notice,showModal,assets,isActive}) {
  const $=s=>document.querySelector(s);
  let selected=null,tab='files',generation=0,current=null;
  const button=(id,label,disabled=false)=>`<button type="button" class="btn" id="${id}" ${disabled?'disabled':''}>${label}</button>`;
  const input=(id,label,value='',type='input')=>`<label class="field"><span>${label}</span>${type==='textarea'?`<textarea id="${id}">${e(value)}</textarea>`:`<input id="${id}" value="${e(value)}">`}</label>`;
  const close=()=>$('#modal').close();
  const run=async(fn)=>{try{await fn();}catch(error){notice(error.message,'error');}};
  const dialog=(title,html,submit)=>{showModal(title,`<form id="plugin-dialog">${html}<div class="plugin-actions"><button class="btn btn-primary" type="submit">确认</button></div></form>`);$('#plugin-dialog').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;run(async()=>{const b=form.querySelector('[type=submit]');b.disabled=true;try{await submit();close();await render();}finally{b.disabled=false;}});};};
  const act=async(action,body={})=>{const p=await api(`plugins/${selected}/${action}`,'POST',body);current=p;await render();if(p.rebasing)notice('rebase 有待处理的冲突，请在仓库与同步中解决。','error');else notice('操作完成');};
  function create() {
    dialog('新建 Plugin',`${input('plugin-title','名称')}${input('plugin-purpose','共同用途 / 说明','','textarea')}<label class="field"><span>来源</span><select id="plugin-source"><option value="local">新建本地包</option><option value="directory">导入本地目录</option><option value="third-party">他人的 GitHub 项目</option><option value="owned">自己的 GitHub 仓库</option></select></label>${input('plugin-url','GitHub 仓库地址（远程来源填写）')}${input('plugin-directory','本地目录（目录导入填写）')}${button('plugin-pick','选择文件夹')}<p class="muted">他人项目的默认分支只接收上游更新；自己的修改必须保存到自己的分支。导入不会执行脚本。</p>`,async()=>{
      const source=$('#plugin-source').value;
      const p=await api('plugins','POST',{title:$('#plugin-title').value,description:$('#plugin-purpose').value,ownership:source==='directory'?'local':source,url:['owned','third-party'].includes(source)?$('#plugin-url').value:'',directory:source==='directory'?$('#plugin-directory').value:''});selected=p.id;tab='files';
    });
    $('#plugin-pick').onclick=()=>run(async()=>{$('#plugin-directory').value=(await api('pick-directory','POST',{})).directory||'';});
  }
  function editFile(name='',content='',conflict=false) {
    dialog(conflict?'解决冲突文件':name?'编辑文件':'添加文件',`${input('plugin-path','包内相对路径',name)}${input('plugin-content','文件内容',content,'textarea')}${conflict?'':input('plugin-message','版本说明')}<p class="muted">${conflict?'编辑为最终内容后确认，再点击继续 rebase。':'保存会在当前分支创建提交。'}</p>`,async()=>{
      if(conflict)await api(`plugins/${selected}/resolve`,'POST',{path:name,content:$('#plugin-content').value});
      else await api(`plugins/${selected}/save`,'POST',{message:$('#plugin-message').value,files:[{path:$('#plugin-path').value,content:$('#plugin-content').value}]});
    });
    if(name)$('#plugin-path').readOnly=true;
    $('#plugin-content').style.minHeight='320px';
  }
  async function openFile(name,conflict=false) {const f=await api(`plugins/${selected}/file?path=${encodeURIComponent(name)}`);if(f.binary){notice('二进制文件不能在线编辑，可以上传替换。','error');return;}if(!conflict&&(current.readOnly||current.rebasing)){showModal('查看文件',`<p class="plugin-warning">保存修改前请先创建或切换到自己的分支；rebase 期间请先处理冲突。</p><pre>${e(f.content)}</pre>`);return;}editFile(name,f.content,conflict);}
  function branchDialog(push=false) {
    dialog(push?'创建分支并推送':'创建自己的分支',`${input('plugin-branch','新分支名称','my-changes')}<p class="muted">新分支基于当前分支创建；上游来源会继续保留。</p>`,async()=>{await api(`plugins/${selected}/${push?'push':'branch'}`,'POST',push?{newBranch:$('#plugin-branch').value}:{name:$('#plugin-branch').value,create:true});});
  }
  function filesHTML(p) {
    return `<div class="plugin-actions">${button('plugin-add-file','添加文本文件',p.readOnly||p.rebasing)}${button('plugin-upload','上传文件 / 替换文件',p.readOnly||p.rebasing)}${button('plugin-upload-folder','上传文件夹',p.readOnly||p.rebasing)}<input type="file" id="plugin-files" multiple hidden><input type="file" id="plugin-folder" webkitdirectory multiple hidden></div><p class="muted">完整包内容，包括资产、脚本和配置。脚本只保存，不自动执行。每次上传最多 12 MB。</p><div class="plugin-file-list">${p.files.map(f=>`<div class="plugin-file"><button class="btn btn-sm" data-file="${e(f.path)}">${e(f.path)}</button><small>${f.size.toLocaleString()} 字节</small><button class="btn btn-sm" data-delete="${e(f.path)}" ${p.readOnly||p.rebasing?'disabled':''}>删除</button></div>`).join('')||'<p class="empty">包内还没有文件。</p>'}</div>`;
  }
  function versionsHTML(p) {
    const fresh=(p.releases||[]).filter(r=>!r.adopted&&!r.prerelease);
    return `<div class="plugin-actions">${button('plugin-check','检查远端更新',!p.upstreamUrl)}${button('plugin-upstream-diff','预览上游差异',!p.upstreamUrl||!p.checkedAt)}${button('plugin-update','更新默认分支',!p.upstreamUrl||p.dirty||p.rebasing)}</div>${fresh.length?`<div class="plugin-release-alert">★ 有 ${fresh.length} 个未采用的正式 Release</div>`:''}<p>Commit 更新：${p.commitUpdates} 个 · ${p.checkedAt?'上次检查 '+e(new Date(p.checkedAt).toLocaleString()):'尚未检查'}</p>${p.releaseError?`<p class="plugin-warning">${e(p.releaseError)}。Commit 检查仍可用；私有仓库的 Release 需要 GitHub 访问授权。</p>`:''}<h3>Releases</h3>${(p.releases||[]).map(r=>`<details class="plugin-release"><summary>★ ${e(r.tag)} · ${r.prerelease?'预发布':'正式 Release'} · ${r.adopted?'已包含在默认分支':'未采用'}</summary><p>${e(r.name)} · ${e(r.publishedAt||'')}</p><pre>${e(r.body)}</pre></details>`).join('')||'<p class="muted">暂无 Release 信息</p>'}<h3>上游新提交</h3>${p.commits.map(c=>`<p class="muted">${e(c)}</p>`).join('')||'<p class="muted">没有已检测到的新提交</p>'}<h3>当前分支历史</h3>${p.history.map(h=>`<div class="plugin-history"><strong>${e(h.message)}</strong><small>${e(h.hash.slice(0,8))} · ${e(h.date)}</small><button class="btn btn-sm" data-diff="${h.hash}">查看此版本变化</button><button class="btn btn-sm" data-plugin-restore="${h.hash}" ${p.readOnly||p.dirty||p.rebasing?'disabled':''}>恢复内容并保存新版本</button></div>`).join('')}`;
  }
  function syncHTML(p) {
    return `<p>上游仓库：${e(p.upstreamUrl||'未关联')}</p><p>我的仓库 / Fork：${e(p.forkUrl||'未关联')}</p><p>默认分支：${e(p.defaultBranch)} · 当前分支：${e(p.currentBranch||'rebase 处理中')}</p><p class="muted">先更新默认分支，再将自己的分支 rebase 到新版。rebase 可能出现冲突；已推送分支改写历史后，普通推送可能被拒绝，请使用新分支推送。</p><div class="plugin-actions">${button('plugin-branch','创建自己的分支',p.dirty||p.rebasing)}<select id="plugin-switch" ${p.dirty||p.rebasing?'disabled':''}>${p.branches.map(b=>`<option ${b===p.currentBranch?'selected':''} value="${e(b)}">${e(b)}</option>`).join('')}</select>${button('plugin-remote','关联自己的仓库 / Fork',p.dirty||p.rebasing)}${button('plugin-update','更新默认分支',!p.upstreamUrl||p.dirty||p.rebasing)}${button('plugin-rebase','更新并 rebase 自己的分支',!p.upstreamUrl||p.currentBranch===p.defaultBranch||p.dirty||p.rebasing)}${button('plugin-push','推送当前分支',!p.forkUrl||p.readOnly||p.dirty||p.rebasing)}${button('plugin-push-new','新建分支并推送',!p.forkUrl||p.dirty||p.rebasing)}</div>${p.upstreamUrl&&p.ownership==='third-party'?`<p><a href="https://github.com/${e(p.upstreamUrl.replace(/^https:\/\/github.com\/|^git@github.com:/,'').replace(/\.git\/?$|\/$/g,''))}/fork" target="_blank" rel="noopener">在 GitHub 创建 Fork</a>，创建完成后将 Fork 仓库链接关联到这里。</p>`:''}${p.dirty&&!p.rebasing?`${button('plugin-commit','提交工作区修改',p.readOnly)}`:''}${p.rebasing?`<div class="plugin-warning"><h3>rebase 待处理</h3>${p.conflicts.map(f=>`<div class="plugin-actions"><button class="btn" data-conflict="${e(f)}">解决 ${e(f)}</button><button class="btn" data-conflict-delete="${e(f)}">按删除解决</button></div>`).join('')}${button('plugin-continue','继续 rebase',!!p.conflicts.length)}${button('plugin-abort','取消 rebase')}</div>`:''}`;
  }
  async function render() {
    const token=++generation;if(!isActive())return;
    $('#new-button').style.display='';$('#new-button').textContent='＋ 新建 Plugin';$('#new-button').onclick=create;
    try {
      const items=await api('plugins');if(token!==generation||!isActive())return;
      if(selected&&!items.some(p=>p.id===selected))selected=null;
      const p=selected?await api(`plugins/${selected}`):null;if(token!==generation||!isActive())return;current=p;
      $('#content').innerHTML=`<div class="intro"><div><h2>围绕共同用途组织的完整包</h2><p>容纳各类资产与其他文件，独立管理版本、上游更新和自己的修改。</p></div></div><div class="workspace"><aside class="panel"><div class="panel-head"><h3>Plugins</h3><span>${items.length} 项</span></div><div class="asset-list">${items.map(x=>`<button class="asset-item ${x.id===selected?'active':''}" data-plugin="${x.id}"><span class="asset-glyph">▣</span><div><strong>${e(x.title)}</strong><small>${e(x.description||x.upstreamUrl||'本地包')}</small>${(x.releases||[]).some(r=>!r.adopted&&!r.prerelease)?'<small class="plugin-release-alert">★ 新正式 Release</small>':''}</div></button>`).join('')||'<p class="empty">新建本地包或关联 GitHub 项目。</p>'}</div></aside><section class="panel plugin-panel">${p?`<h2>${e(p.title)}</h2><p>${e(p.description)}</p><div class="plugin-status">${e(p.currentBranch||'rebase 中')} · ${e(p.head.slice(0,8))} · ${p.readOnly?'默认分支只读':p.dirty?'有未提交修改':'工作区干净'}</div>${p.readOnly?`<div class="plugin-warning">这是他人项目的默认分支，只用于接收上游更新。保存修改前必须创建或切换到自己的分支。${button('plugin-edit-branch','创建自己的分支')}</div>`:''}<div class="plugin-tabs">${[['files','文件'],['assets','资产'],['versions','版本与更新'],['sync','仓库与同步'],['overview','概览']].map(([key,label])=>`<button class="btn ${key===tab?'btn-primary':''}" data-plugin-tab="${key}">${label}</button>`).join('')}</div><div id="plugin-body">${tab==='files'?filesHTML(p):tab==='versions'?versionsHTML(p):tab==='sync'?syncHTML(p):tab==='overview'?`${input('plugin-meta-title','名称',p.title)}${input('plugin-meta-purpose','共同用途',p.description,'textarea')}${button('plugin-meta-save','保存包信息')}<p class="muted">本地目录：${e(p.directory)}</p>`:'<p>正在识别包内资产…</p>'}</div>`:'<div class="empty">选择一个 Plugin，或新建一个包。</div>'}</section></div>`;
      document.querySelectorAll('[data-plugin]').forEach(b=>b.onclick=()=>{selected=b.dataset.plugin;tab='files';run(render);});
      document.querySelectorAll('[data-plugin-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.pluginTab;run(render);});
      if(!p)return;
      const bind=(id,fn)=>{const b=$('#'+id);if(b)b.onclick=()=>run(async()=>{b.disabled=true;try{await fn();}finally{b.disabled=false;}});};
      bind('plugin-edit-branch',()=>branchDialog());bind('plugin-branch',()=>branchDialog());bind('plugin-push-new',()=>branchDialog(true));
      bind('plugin-add-file',()=>editFile());
      bind('plugin-upload',()=>$('#plugin-files').click());bind('plugin-upload-folder',()=>$('#plugin-folder').click());
      for(const id of ['plugin-files','plugin-folder'])if($('#'+id))$('#'+id).onchange=event=>run(async()=>{
        const chosen=[...event.target.files];if(!chosen.length)return;if(chosen.reduce((n,f)=>n+f.size,0)>12_000_000)throw Error('每次上传最多 12 MB');
        const changes=await Promise.all(chosen.map(async f=>{const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {path:f.webkitRelativePath||f.name,content:btoa(binary),encoding:'base64'};}));
        dialog('保存上传文件',`<p>保存 ${changes.length} 个文件，同路径文件会被替换。</p>${input('plugin-message','版本说明')}`,async()=>{await api(`plugins/${selected}/save`,'POST',{files:changes,message:$('#plugin-message').value});});
      });
      document.querySelectorAll('[data-file]').forEach(b=>b.onclick=()=>run(()=>openFile(b.dataset.file)));
      document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>dialog('删除包内文件',`<p>${e(b.dataset.delete)}</p>${input('plugin-message','版本说明')}`,async()=>{await api(`plugins/${selected}/save`,'POST',{files:[{path:b.dataset.delete,remove:true}],message:$('#plugin-message').value});}));
      for(const action of ['check','update','rebase','push','continue','abort'])bind('plugin-'+action,()=>act(action));
      bind('plugin-commit',()=>dialog('提交工作区修改',input('plugin-message','版本说明'),async()=>{await api(`plugins/${selected}/commit`,'POST',{message:$('#plugin-message').value});}));
      bind('plugin-upstream-diff',async()=>{const d=await api(`plugins/${selected}/upstream-diff`);showVersionDiff(showModal,d);document.querySelector('.vd-toolbar strong').textContent='本机默认分支 → 上游最新版本';});
      bind('plugin-meta-save',()=>act('metadata',{title:$('#plugin-meta-title').value,description:$('#plugin-meta-purpose').value}));
      bind('plugin-remote',()=>dialog('关联我的 GitHub 仓库 / Fork',`${input('plugin-my-remote','仓库链接',p.forkUrl)}<p class="muted">他人项目请填写自己的 Fork；原项目继续作为上游保留。</p>`,async()=>{await api(`plugins/${selected}/remote`,'POST',{url:$('#plugin-my-remote').value});}));
      if($('#plugin-switch'))$('#plugin-switch').onchange=event=>run(()=>act('branch',{name:event.target.value}));
      document.querySelectorAll('[data-conflict]').forEach(b=>b.onclick=()=>run(()=>openFile(b.dataset.conflict,true)));
      document.querySelectorAll('[data-conflict-delete]').forEach(b=>b.onclick=()=>dialog('按删除解决冲突',`<p>确认删除 ${e(b.dataset.conflictDelete)}？</p>`,async()=>{await api(`plugins/${selected}/resolve`,'POST',{path:b.dataset.conflictDelete,remove:true});}));
      document.querySelectorAll('[data-diff]').forEach(b=>b.onclick=()=>run(async()=>{const d=await api(`plugins/${selected}/diff?hash=${b.dataset.diff}`);showVersionDiff(showModal,d);}));
      document.querySelectorAll('[data-plugin-restore]').forEach(b=>b.onclick=()=>dialog('恢复历史内容',`<p>将当前分支的文件恢复到 ${e(b.dataset.pluginRestore.slice(0,8))}，并创建新提交，保留已有历史。</p>${input('plugin-message','版本说明')}`,async()=>{await api(`plugins/${selected}/restore`,'POST',{hash:b.dataset.pluginRestore,message:$('#plugin-message').value});}));
      if(tab==='assets') {
        const scan=await api(`plugins/${selected}/assets`);if(token!==generation||!isActive())return;
        $('#plugin-body').innerHTML=`${button('plugin-add-asset','从资产库放入资产',p.readOnly||p.rebasing)}<p class="muted">包内文件是内容来源。放入已有资产会保存一份包内快照；后续在包内编辑，不会自动修改原资产。</p>${scan.warnings.map(w=>`<p class="plugin-warning">${e(w)}</p>`).join('')}${scan.candidates.map((a,i)=>`<div class="plugin-history"><strong>${e(a.title)}</strong><small>${e(a.type)} · ${e(a.source)}</small><button class="btn btn-sm" data-plugin-asset="${i}">查看内容</button></div>`).join('')||'<p class="empty">没有识别到资产，可从资产库添加，或上传原生资产文件。</p>'}`;
        document.querySelectorAll('[data-plugin-asset]').forEach(b=>b.onclick=()=>{const a=scan.candidates[Number(b.dataset.pluginAsset)];showModal(a.title,`<p>${e(a.error||'')}</p><pre>${e(JSON.stringify(a.asset||a.raw,null,2))}</pre><p class="muted">在文件页编辑对应来源文件即可保存新的包版本。</p>`);});
        bind('plugin-add-asset',()=>{const all=Object.entries(assets()).filter(([t])=>!['project','settings'].includes(t)).flatMap(([type,list])=>list.map(a=>({type,...a})));dialog('从资产库放入资产',`<label class="field"><span>选择资产</span><select id="plugin-asset">${all.map((a,i)=>`<option value="${i}">${e(a.type)} · ${e(a.title||a.name)}</option>`).join('')}</select></label>${input('plugin-message','版本说明')}`,async()=>{const a=all[Number($('#plugin-asset').value)];if(!a)throw Error('没有可添加的资产');await api(`plugins/${selected}/add-asset`,'POST',{type:a.type,assetId:a.id,message:$('#plugin-message').value});});});
      }
    }catch(error){if(token===generation&&isActive())notice(error.message,'error');}
  }
  return {render,create};
}
