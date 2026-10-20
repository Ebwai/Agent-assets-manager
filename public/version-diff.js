const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusLabels={add:'新增',del:'删除',modify:'修改'};

function rowHTML(row,start=false) {
  const text=row.tokens?row.tokens.map(token=>token.changed?`<mark>${escape(token.text)}</mark>`:escape(token.text)).join(''):escape(row.text);
  return `<div class="vd-row vd-${row.kind}" ${start?'data-change-start tabindex="-1"':''}><span class="vd-line">${row.oldLine??''}</span><span class="vd-line">${row.newLine??''}</span><span class="vd-sign" aria-label="${row.kind==='del'?'删除':row.kind==='add'?'新增':'上下文'}">${row.kind==='del'?'−':row.kind==='add'?'+':''}</span><code>${text||'\u200b'}</code></div>`;
}

function rowsHTML(rows=[]) {
  let html='';
  for(let i=0;i<rows.length;) {
    if(rows[i].kind!=='context') {html+=rowHTML(rows[i],i===0||rows[i-1].kind==='context');i++;continue;}
    let end=i;while(rows[end]?.kind==='context')end++;
    const head=i===0?0:2,tail=end===rows.length?0:2;
    if(end-i<=head+tail)html+=rows.slice(i,end).map(row=>rowHTML(row)).join('');
    else {
      html+=rows.slice(i,i+head).map(row=>rowHTML(row)).join('');
      const hidden=rows.slice(i+head,end-tail);
      html+=`<details class="vd-context"><summary>展开 ${hidden.length} 行未变化内容</summary>${hidden.map(row=>rowHTML(row)).join('')}</details>`;
      html+=rows.slice(end-tail,end).map(row=>rowHTML(row)).join('');
    }
    i=end;
  }
  return html;
}

export function diffHTML(result) {
  const files=result.files||[];
  const label=ref=>ref&&/^[a-f0-9]{40}$/.test(ref)?ref.slice(0,8):ref;
  const comparison=result.before?`${escape(label(result.before))} → ${escape(label(result.after))}`:`首次版本 → ${escape(label(result.after))}`;
  return `<div class="version-diff"><div class="vd-toolbar"><div><strong>${result.before?'上一版本 → 所选版本':'首次版本 · 全部为新增'}</strong><small>${comparison}</small></div><div class="vd-controls"><button class="btn btn-sm" data-vd-prev>上一处变化</button><span data-vd-position aria-live="polite"></span><button class="btn btn-sm" data-vd-next>下一处变化</button></div></div><p class="vd-legend"><span class="vd-del-label">− 删除</span><span class="vd-add-label">＋ 新增</span><span>仅展示变化文件及附近内容</span></p>${files.length?`<div class="vd-layout"><nav class="vd-files" aria-label="变化文件">${files.map((file,i)=>`<button type="button" data-vd-file="${i}"><span>${escape(file.path)}</span><b class="vd-${file.status}-label">${statusLabels[file.status]}</b></button>`).join('')}</nav><div class="vd-content">${files.map((file,i)=>`<section class="vd-file" data-vd-section="${i}"><header><strong>${escape(file.path)}</strong><span class="vd-${file.status}-label">${statusLabels[file.status]}</span></header>${file.binary?'<p class="vd-binary" data-change-start tabindex="-1">二进制文件内容发生变化，无法以文本对照。</p>':file.changes?file.changes.map(change=>`<div class="vd-config"><h3>${escape(change.field)} <span class="vd-${change.kind}-label">${statusLabels[change.kind]}</span></h3>${rowsHTML(change.rows)}</div>`).join(''):(file.rows?.length?rowsHTML(file.rows):'<p class="vd-binary" data-change-start tabindex="-1">空文件</p>')}</section>`).join('')}</div></div>`:'<div class="empty">这个版本没有文件内容或配置变化。</div>'}</div>`;
}

export function showVersionDiff(showModal,result,footer='') {
  showModal('版本变化',diffHTML(result)+footer);
  const root=document.querySelector('#modal-body .version-diff');
  root.closest('dialog').classList.add('version-diff-modal');
  const changes=[...root.querySelectorAll('[data-change-start]')];let current=-1;
  const position=root.querySelector('[data-vd-position]');
  const prev=root.querySelector('[data-vd-prev]'),next=root.querySelector('[data-vd-next]');
  const update=()=>{position.textContent=changes.length?`${current+1} / ${changes.length}`:'无变化';prev.disabled=!changes.length;next.disabled=!changes.length;};
  const go=index=>{
    if(!changes.length)return;
    current=(index+changes.length)%changes.length;
    root.querySelector('.vd-focused')?.classList.remove('vd-focused');
    const fileIndex=changes[current].closest('[data-vd-section]').dataset.vdSection;
    root.querySelectorAll('[data-vd-file]').forEach(b=>b.classList.toggle('active',b.dataset.vdFile===fileIndex));
    changes[current].classList.add('vd-focused');changes[current].scrollIntoView({block:'center',behavior:'smooth'});changes[current].focus({preventScroll:true});update();
  };
  prev.onclick=()=>go(current<0?changes.length-1:current-1);next.onclick=()=>go(current+1);
  root.querySelectorAll('[data-vd-file]').forEach(button=>button.onclick=()=>{
    root.querySelectorAll('[data-vd-file]').forEach(b=>b.classList.toggle('active',b===button));
    const section=root.querySelector(`[data-vd-section="${button.dataset.vdFile}"]`);
    section.scrollIntoView({block:'start',behavior:'smooth'});
    const first=section.querySelector('[data-change-start]');current=changes.indexOf(first);
    root.querySelector('.vd-focused')?.classList.remove('vd-focused');first?.classList.add('vd-focused');update();
  });
  root.querySelector('[data-vd-file]')?.classList.add('active');current=changes.length?0:-1;update();
}
