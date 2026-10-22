import { modelProtocols, modelProtocol, aiModelId, serviceModelIds } from './model-protocols.js';
import { openModelApplication } from './model-application.js';

export function renderModelFields(d, field, escapeHtml) {
  const protocol = modelProtocols.find(item => item.id === modelProtocol(d)) || modelProtocols[0];
  const ids = serviceModelIds(d), selected = aiModelId(d);
  const aiOptions = ids.map(id => `<option value="${escapeHtml(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(id)}</option>`).join('');
  return `<div class="form-grid">
    ${field('供应商 / 服务名称', 'title', d.title, { required: true })}
    <div class="field"><label class="field-label" for="model-protocol">API 协议</label><select id="model-protocol" data-bind="protocol">${modelProtocols.map(item => `<option value="${item.id}" ${item.id === protocol.id ? 'selected' : ''}>${item.name}</option>`).join('')}</select></div>
    ${field('API 地址（基础地址或完整调用地址）', 'baseUrl', d.baseUrl, { required: true, wide: true, placeholder: protocol.baseUrl })}
    <div class="field"><label class="field-label" for="model-auth-mode">认证方式</label><select id="model-auth-mode" data-bind="authMode"><option value="key" ${d.authMode !== 'none' ? 'selected' : ''}>API Key</option><option value="none" ${d.authMode === 'none' ? 'selected' : ''}>无需密钥（本地服务）</option></select></div>
    <div class="field wide"><label class="field-label" for="api-key">API Key <span class="pill gray">本机私有</span></label><input id="api-key" type="password" value="" autocomplete="new-password" placeholder="${d.hasKey || d.apiKey ? '已有密钥；留空表示不修改' : '输入 API Key'}"><span class="hint">地址、协议和 Key 由此供应商的模型共享；Key 不进入 Git。</span></div>
    <div class="field wide"><label class="field-label" for="model-ids">供应商模型列表（每行一个模型 ID）</label><textarea id="model-ids" rows="6" placeholder="${escapeHtml(protocol.example)}">${escapeHtml(ids.join('\n'))}</textarea><div class="quick-links"><button type="button" class="btn" id="model-discover">从 API 获取模型列表</button></div><span class="hint">可以手工添加或删除；获取结果会合并到列表，不自动保存。</span><div id="model-discovery-result" role="status"></div></div>
    <div class="field wide"><label class="field-label" for="model-ai-model">资产 AI 辅助使用的模型</label><select id="model-ai-model"><option value="">请选择模型</option>${selected && !ids.includes(selected) ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}（不在列表中，请重新选择）</option>` : ''}${aiOptions}</select><span class="hint">用于资产审查、改进及画板 AI；应用到 Claude Code / Codex 时会另外选择模型，不改变此设置。</span></div>
    <div class="field wide"><label class="field-label">各模型能力</label><div id="model-capabilities"></div><span class="hint">上下文窗口是输入、历史与输出共享的总容量，1M 填 1000000。推理强度须由供应商支持；配置保存后供目标软件应用使用，不会扩大模型真实容量。</span></div>
    ${field('说明', 'description', d.description, { wide: true })}
    <details class="field wide"><summary>目标软件网关与兼容选项</summary><div class="form-grid" style="margin-top:12px">
      ${field('Claude Code 的 Messages 兼容地址（可选）', 'claudeBaseUrl', d.claudeBaseUrl, { wide: true, placeholder: '留空时使用兼容的主地址' })}
      ${field('Codex 的 Responses 兼容地址（可选）', 'codexBaseUrl', d.codexBaseUrl, { wide: true, placeholder: 'https://gateway.example/v1' })}
      <div class="field wide"><label class="field-label" for="model-token-parameter">Chat Completions 输出长度参数</label><select id="model-token-parameter" data-bind="tokenParameter"><option value="max_tokens" ${d.tokenParameter !== 'max_completion_tokens' ? 'selected' : ''}>max_tokens（常见兼容服务）</option><option value="max_completion_tokens" ${d.tokenParameter === 'max_completion_tokens' ? 'selected' : ''}>max_completion_tokens（要求此参数的模型）</option></select></div>
    </div><p class="small-note">网关复用此服务的 Key；凭据不同时另建服务。不内置协议转换网关。连接测试仅验证资产 AI 辅助模型的文本调用。</p></details>
  </div><div class="quick-links"><button type="button" class="btn" id="model-test">测试 AI 辅助模型连接</button><button type="button" class="btn" id="model-apply">应用 / 撤销用户级 API</button></div><div id="model-test-result" role="status"></div>`;
}

export function bindModelFields({ draft, api, notice, render, showModal, escapeHtml }) {
  const $ = selector => document.querySelector(selector);
  const refreshCapabilities = () => {
    const rows = serviceModelIds(draft).map(id => ({ id, contextWindow: 32768, reasoning: 'none', ...draft.modelCapabilities?.find(row => row.id === id) }));
    $('#model-capabilities').innerHTML = `<table class="model-mapping-table"><thead><tr><th>模型 ID</th><th>上下文窗口 tokens</th><th>多个推理强度</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td>${escapeHtml(row.id)}</td><td><input aria-label="${escapeHtml(row.id)} 上下文窗口" data-cap-context="${index}" type="number" min="4096" max="2000000" value="${row.contextWindow}"></td><td><select aria-label="${escapeHtml(row.id)} 推理强度" data-cap-reasoning="${index}"><option value="none" ${row.reasoning === 'none' ? 'selected' : ''}>关闭（不发送）</option><option value="standard" ${row.reasoning === 'standard' ? 'selected' : ''}>开启 low / medium / high</option></select></td></tr>`).join('')}</tbody></table>`;
    const save = () => { draft.modelCapabilities = rows; };
    // Explicitly persist the complete per-model definition on the next asset save.
    save();
    for (const input of document.querySelectorAll('[data-cap-context]')) input.oninput = () => { rows[Number(input.dataset.capContext)].contextWindow = Number(input.value); save(); };
    for (const input of document.querySelectorAll('[data-cap-reasoning]')) input.onchange = () => { rows[Number(input.dataset.capReasoning)].reasoning = input.value; save(); };
  };
  const needsLegacyCapabilities = draft.modelCapabilities === undefined;
  refreshCapabilities();
  if (needsLegacyCapabilities && draft.id) {
    const initial = JSON.stringify(draft.modelCapabilities), host = $('#model-capabilities');
    api('model-application-state?modelId=' + encodeURIComponent(draft.id)).then(saved => {
      if (!host.isConnected || JSON.stringify(draft.modelCapabilities) !== initial) return;
      const old = saved.codex?.modelMapping?.models;
      if (old?.length) {
        draft.modelCapabilities = draft.modelCapabilities.map(row => { const previous = old.find(item => item.id === row.id); return previous ? { id: row.id, contextWindow: previous.contextWindow ?? 32768, reasoning: previous.reasoning ?? 'none' } : row; });
        refreshCapabilities();
      }
    }).catch(error => notice('旧应用能力配置读取失败：' + error.message, true));
  }
  $('#api-key').oninput = event => { draft.apiKey = event.target.value; };
  $('#model-protocol').onchange = event => {
    if (modelProtocols.some(item => item.baseUrl === draft.baseUrl) || !draft.baseUrl) draft.baseUrl = modelProtocols.find(item => item.id === event.target.value).baseUrl;
    draft.protocol = event.target.value; render();
  };
  const refreshChoices = () => {
    refreshCapabilities();
    const ids = serviceModelIds(draft), selected = aiModelId(draft);
    $('#model-ai-model').innerHTML = '<option value="">请选择模型</option>' + (selected && !ids.includes(selected) ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}（不在列表中，请重新选择）</option>` : '') + ids.map(id => `<option value="${escapeHtml(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(id)}</option>`).join('');
  };
  $('#model-ids').oninput = event => { draft.models = [...new Set(event.target.value.split(/\r?\n/).map(id => id.trim()).filter(Boolean))]; refreshChoices(); };
  $('#model-ai-model').onchange = event => { draft.aiModel = event.target.value; draft.model = event.target.value; };
  $('#model-discover').onclick = async () => {
    const button = $('#model-discover'), output = $('#model-discovery-result');
    const snapshot = structuredClone(draft);
    button.disabled = true; output.textContent = '正在获取模型列表…';
    try {
      const result = await api('model-discovery', 'POST', { asset: snapshot });
      if (!output.isConnected) return;
      if (draft.baseUrl !== snapshot.baseUrl || modelProtocol(draft) !== modelProtocol(snapshot) || draft.apiKey !== snapshot.apiKey || draft.authMode !== snapshot.authMode) { output.textContent = '供应商配置已变化，请重新获取。'; return; }
      draft.models = [...new Set([...serviceModelIds(draft), ...result.models])];
      $('#model-ids').value = draft.models.join('\n'); refreshChoices();
      output.textContent = `已获取 ${result.models.length} 个模型，合并后共 ${draft.models.length} 个。请选择 AI 辅助模型后保存。`;
    } catch (error) { if (output.isConnected) output.textContent = `获取失败：${error.message}；可继续手工维护列表。`; }
    finally { button.disabled = false; }
  };
  $('#model-test').onclick = async () => {
    const button = $('#model-test'), output = $('#model-test-result');
    button.disabled = true; output.textContent = '正在测试 AI 辅助模型…';
    try { const result = await api('model-test', 'POST', { asset: structuredClone(draft) }); output.textContent = `连接成功：${result.text}`; }
    catch (error) { output.textContent = `连接失败：${error.message}`; }
    finally { button.disabled = false; }
  };
  $('#model-apply').onclick = () => openModelApplication({ draft, api, notice, showModal, escapeHtml, button: $('#model-apply') });
}
