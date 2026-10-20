import { modelProtocols, modelProtocol, aiModelId, serviceModelIds } from './model-protocols.js';

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
  $('#api-key').oninput = event => { draft.apiKey = event.target.value; };
  $('#model-protocol').onchange = event => {
    if (modelProtocols.some(item => item.baseUrl === draft.baseUrl) || !draft.baseUrl) draft.baseUrl = modelProtocols.find(item => item.id === event.target.value).baseUrl;
    draft.protocol = event.target.value; render();
  };
  const refreshChoices = () => {
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
  $('#model-apply').onclick = async () => {
    const modelId = draft.id, button = $('#model-apply');
    let service = draft;
    try { if (modelId) service = await api('model/' + modelId); }
    catch (error) { return notice(error.message, true); }
    if (!button.isConnected) return;
    const ids = serviceModelIds(service);
    showModal('应用用户级自定义 API', `<p class="small-note">使用已保存供应商中的模型。两种软件都应用到本机用户级，不需要选择项目；只预览不会改动文件。</p><div class="form-grid">
      <div class="field"><label class="field-label" for="model-apply-software">目标软件</label><select id="model-apply-software"><option value="claude">Claude Code</option><option value="codex">Codex</option></select></div>
      <div class="field"><label class="field-label" for="model-apply-action">操作</label><select id="model-apply-action"><option value="apply" ${modelId ? '' : 'disabled'}>应用此供应商 API</option><option value="restore" ${modelId ? '' : 'selected'}>撤销助手配置，恢复原值</option></select></div>
      <div class="field wide" id="model-apply-model-field"><label class="field-label" for="model-apply-model">目标软件使用的模型</label><select id="model-apply-model">${ids.map(id => `<option value="${escapeHtml(id)}" ${id === aiModelId(service) ? 'selected' : ''}>${escapeHtml(id)}</option>`).join('')}</select><span class="hint">本次选择只影响目标软件，不改变资产 AI 辅助模型。</span></div>
      </div><p id="model-apply-scope" class="small-note"></p><div class="quick-links"><button class="btn btn-primary" id="model-apply-preview">预览配置</button></div><div id="model-apply-preview-result" role="status"></div>`);
    let generation = 0;
    const invalidate = () => {
      generation++;
      const software = $('#model-apply-software').value;
      $('#model-apply-model-field').style.display = $('#model-apply-action').value === 'restore' ? 'none' : '';
      $('#model-apply-scope').textContent = `作用范围：本机当前用户的 ${software === 'codex' ? 'Codex' : 'Claude Code'} 配置，影响使用该配置的新会话。应用后请重新启动目标软件。`;
      $('#model-apply-preview-result').innerHTML = '';
    };
    for (const selector of ['#model-apply-software', '#model-apply-action', '#model-apply-model']) $(selector).onchange = invalidate;
    invalidate();
    $('#model-apply-preview').onclick = async () => {
      const previewButton = $('#model-apply-preview'), output = $('#model-apply-preview-result');
      const values = { modelId, software: $('#model-apply-software').value, selectedModel: $('#model-apply-model').value, restore: $('#model-apply-action').value === 'restore' };
      if (!values.restore && !modelId) return notice('请先保存供应商服务', true);
      const current = ++generation; previewButton.disabled = true; output.textContent = '正在读取配置…';
      try {
        const result = await api('model-application', 'POST', { ...values, preview: true });
        if (current !== generation || !output.isConnected) return;
        output.innerHTML = `<p><strong>${escapeHtml(result.scope)}</strong></p><p>${escapeHtml(result.path)}</p><details class="preview-file"><summary>当前配置</summary><pre>${escapeHtml(result.before)}</pre></details><details class="preview-file" open><summary>${result.restore ? '恢复后的配置' : '应用后的配置'}</summary><pre>${escapeHtml(result.after)}</pre></details>${(result.legacyRestorations || []).map(item => `<details class="preview-file"><summary>同时撤销旧版项目 API 覆盖：${escapeHtml(item.path)}</summary><p>恢复前：</p><pre>${escapeHtml(item.before)}</pre><p>恢复后：</p><pre>${escapeHtml(item.after)}</pre></details>`).join('')}<p class="small-note">密钥由本机私有存储提供。环境变量、其他手动项目覆盖和组织策略可能覆盖用户级配置。撤销只恢复助手管理的字段。</p><div class="quick-links"><button class="btn btn-primary" id="model-apply-confirm">${result.restore ? '确认撤销' : '确认应用到用户级'}</button></div>`;
        const confirm = $('#model-apply-confirm');
        confirm.onclick = async () => {
          confirm.disabled = true;
          try { await api('model-application', 'POST', { ...values, token: result.token }); if (current === generation && output.isConnected) output.textContent = `${result.restore ? '已恢复原用户级 API 配置' : '已应用用户级 API'}：${result.path}。请重新启动目标软件。`; }
          catch (error) { if (current === generation) { output.textContent = error.message; notice(error.message, true); } }
        };
      } catch (error) { if (current === generation) output.textContent = error.message; }
      finally { previewButton.disabled = false; }
    };
  };
}
