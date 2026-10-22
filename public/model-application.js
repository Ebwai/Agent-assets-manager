import { aiModelId, serviceModelIds, normalizeModelCapability } from './model-protocols.js';
import { claudeModelSlots } from './model-mapping.js';

export async function openModelApplication({ draft, api, notice, showModal, escapeHtml, button }) {
  const $ = selector => document.querySelector(selector), modelId = draft.id;
  let service = draft, saved = {};
  try {
    if (modelId) {
      service = await api('model/' + modelId);
      saved = await api('model-application-state?modelId=' + encodeURIComponent(modelId));
    }
  } catch (error) { return notice(error.message, true); }
  if (!button.isConnected) return;
  const ids = serviceModelIds(service), e = escapeHtml, states = {};
  const options = selected => ids.map(id => `<option value="${e(id)}" ${id === selected ? 'selected' : ''}>${e(id)}</option>`).join('');
  for (const software of ['claude', 'codex']) {
    const old = saved[software], selectedModel = ids.includes(old?.selectedModel) ? old.selectedModel : aiModelId(service);
    states[software] = { selectedModel, rows: ids.map(id => {
      const row = old?.modelMapping?.models?.find(item => item.id === id);
      return { id, label: row?.label || id, ...normalizeModelCapability(service.modelCapabilities !== undefined ? service.modelCapabilities.find(item => item.id === id) : row), included: old?.modelMapping ? !!row : true };
    }), claude: Object.fromEntries(claudeModelSlots.map(([slot]) => [slot, ids.includes(old?.modelMapping?.claude?.[slot]) ? old.modelMapping.claude[slot] : selectedModel])), overrides: Object.entries(old?.modelMapping?.overrides || {}).map(([source, id]) => `${source}=${id}`).join('\n'), reviewModel: ids.includes(old?.modelMapping?.reviewModel) ? old.modelMapping.reviewModel : selectedModel };
  }
  showModal('应用用户级自定义 API', `<p class="small-note">使用已保存供应商。配置本机用户级 API，不需要项目；只预览不会写文件，也不改变资产 AI 辅助模型。</p><div class="form-grid">
    <div class="field"><label class="field-label" for="model-apply-software">目标软件</label><select id="model-apply-software"><option value="claude">Claude Code</option><option value="codex">Codex</option></select></div>
    <div class="field"><label class="field-label" for="model-apply-action">操作</label><select id="model-apply-action"><option value="apply" ${modelId ? '' : 'disabled'}>应用此供应商 API</option><option value="restore" ${modelId ? '' : 'selected'}>撤销助手配置，恢复原值</option></select></div>
    </div><div id="model-apply-mapping"></div><p id="model-apply-scope" class="small-note"></p><button class="btn btn-primary" id="model-apply-preview">预览配置与映射</button><div id="model-apply-preview-result" role="status"></div>`);
  let generation = 0, software = 'claude';
  const invalidate = () => { generation++; $('#model-apply-preview-result').innerHTML = ''; };
  const renderMapping = () => {
    const state = states[software], isCodex = software === 'codex';
    $('#model-apply-mapping').innerHTML = `<div class="field"><label class="field-label" for="model-apply-model">默认模型（真实供应商 ID）</label><select id="model-apply-model">${options(state.selectedModel)}</select></div>
      <h3>目标软件模型列表</h3><p class="small-note">勾选需要列出的模型。显示名称旁会保留真实 ID，实际请求使用该 ID。</p>
      <div style="max-height:320px;overflow:auto"><table class="model-mapping-table"><thead><tr><th>加入列表</th><th>显示名称</th><th>已保存模型能力</th></tr></thead><tbody>${state.rows.map((row, index) => `<tr><td><label><input type="checkbox" data-map-include="${index}" ${row.included ? 'checked' : ''}> ${e(row.id)}</label></td><td><input aria-label="${e(row.id)} 显示名称" data-map-label="${index}" value="${e(row.label)}"></td><td>${row.contextWindow} tokens；${row.reasoning === 'standard' ? 'low / medium / high' : '不发送推理强度'}</td></tr>`).join('')}</tbody></table></div>
      ${isCodex ? `<p class="small-note">上下文和推理能力来自模型服务配置，修改后保存并重新应用；默认按文本／函数工具兼容配置，不宣称具备 GPT 专有能力。此目录用于 Codex 本地模式，不改变 ChatGPT 云端模型。</p><div class="field"><label class="field-label" for="map-review">代码审查模型</label><select id="map-review">${options(state.reviewModel)}</select></div>` : `<h3>Claude Code 别名 → 供应商模型</h3><div class="form-grid">${claudeModelSlots.map(([slot, label]) => `<div class="field"><label class="field-label" for="map-${slot}">${e(label)}</label><select id="map-${slot}">${options(state.claude[slot])}</select></div>`).join('')}</div><details><summary>指定 Claude 版本的映射（可选）</summary><p class="small-note">每行：完整 Claude 模型 ID=供应商模型 ID，例如 claude-sonnet-4-6=deepseek-flash。只有显式列出的版本会映射。</p><textarea id="map-overrides" aria-label="Claude 版本映射" rows="4">${e(state.overrides)}</textarea></details><p class="small-note">完整自定义列表需要 Claude Code 2.1.242+。旧版本使用上述别名映射；Agent 内显式模型和组织限制仍可能优先。</p>`}`;
    $('#model-apply-model').onchange = event => { state.selectedModel = event.target.value; const index = state.rows.findIndex(row => row.id === state.selectedModel); if (index >= 0) { state.rows[index].included = true; document.querySelector(`[data-map-include="${index}"]`).checked = true; } invalidate(); };
    for (const [attr, property, convert] of [['include', 'included', element => element.checked], ['label', 'label', element => element.value]]) {
      for (const element of document.querySelectorAll(`[data-map-${attr}]`)) element.oninput = () => { state.rows[Number(element.getAttribute('data-map-' + attr))][property] = convert(element); invalidate(); };
    }
    if (isCodex) $('#map-review').onchange = event => { state.reviewModel = event.target.value; invalidate(); };
    else {
      for (const [slot] of claudeModelSlots) $('#map-' + slot).onchange = event => { state.claude[slot] = event.target.value; invalidate(); };
      $('#map-overrides').oninput = event => { state.overrides = event.target.value; invalidate(); };
    }
  };
  const updateScope = () => {
    $('#model-apply-mapping').hidden = $('#model-apply-action').value === 'restore';
    $('#model-apply-scope').textContent = `作用范围：本机当前用户的 ${software === 'codex' ? 'Codex' : 'Claude Code'}。应用后完全退出客户端再重启，并新建聊天；已有聊天的模型选择不会自动修改。`;
    invalidate();
  };
  $('#model-apply-software').onchange = event => { software = event.target.value; renderMapping(); updateScope(); };
  $('#model-apply-action').onchange = updateScope;
  renderMapping(); updateScope();
  $('#model-apply-preview').onclick = async () => {
    const previewButton = $('#model-apply-preview'), output = $('#model-apply-preview-result'), state = states[software];
    const restore = $('#model-apply-action').value === 'restore';
    if (!restore && !modelId) return notice('请先保存供应商服务', true);
    const overrides = Object.create(null);
    if (software === 'claude' && !restore) {
      for (const line of state.overrides.split(/\r?\n/).filter(line => line.trim())) {
        const match = line.match(/^\s*([^=]+?)\s*=\s*(.+?)\s*$/);
        if (!match || Object.hasOwn(overrides, match[1])) return notice('版本映射需每行一个 ID=目标 ID，且不能重复', true);
        overrides[match[1]] = match[2];
      }
    }
    const values = structuredClone({ modelId, software, selectedModel: state.selectedModel, restore, modelMapping: { models: state.rows.filter(row => row.included).map(({ included, ...row }) => row), claude: state.claude, overrides, reviewModel: state.reviewModel } });
    const current = ++generation; previewButton.disabled = true; output.textContent = '正在生成配置与模型目录预览…';
    try {
      const result = await api('model-application', 'POST', { ...values, preview: true });
      if (current !== generation || !output.isConnected) return;
      output.innerHTML = `<p><strong>${e(result.scope)}</strong></p>${(result.warnings || []).map(message => `<p class="small-note">${e(message)}</p>`).join('')}${result.modelMapping ? `<details class="preview-file" open><summary>本次模型映射</summary><pre>${e(JSON.stringify(result.modelMapping, null, 2))}</pre></details>` : ''}${[{ path: result.path, before: result.before, after: result.after }, ...(result.additionalFiles || []), ...(result.legacyRestorations || [])].map(file => `<details class="preview-file" open><summary>${e(file.path)}</summary><p>修改前</p><pre>${e(file.before)}</pre><p>修改后</p><pre>${e(file.after)}</pre></details>`).join('')}<p class="small-note">密钥由本机私有存储提供；只更新预览中的受管字段，保留其他设置。</p><button class="btn btn-primary" id="model-apply-confirm">${restore ? '确认撤销' : '确认应用到用户级'}</button>`;
      const confirm = $('#model-apply-confirm');
      confirm.onclick = async () => {
        confirm.disabled = true;
        try { await api('model-application', 'POST', { ...values, token: result.token }); if (current === generation && output.isConnected) output.textContent = `${restore ? '已恢复原用户级 API 配置' : '已应用用户级 API 与模型映射'}。请完全退出目标软件再重启，并新建聊天选择供应商模型。`; }
        catch (error) { if (current === generation && output.isConnected) output.textContent = error.message; }
      };
    } catch (error) { if (current === generation && output.isConnected) output.textContent = error.message; }
    finally { previewButton.disabled = false; }
  };
}
