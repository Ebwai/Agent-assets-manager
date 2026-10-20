import { modelProtocols, modelProtocol } from './model-protocols.js';

export function renderModelFields(d, field, escapeHtml) {
  const protocol = modelProtocols.find(item => item.id === modelProtocol(d)) || modelProtocols[0];
  return `<div class="form-grid">
    ${field('配置名称', 'title', d.title, { required: true })}
    <div class="field"><label class="field-label" for="model-protocol">API 协议</label><select id="model-protocol" data-bind="protocol">${modelProtocols.map(item => `<option value="${item.id}" ${item.id === protocol.id ? 'selected' : ''}>${item.name}</option>`).join('')}</select></div>
    ${field('模型 ID', 'model', d.model, { required: true, placeholder: protocol.example })}
    ${field('API 地址（基础地址或完整调用地址）', 'baseUrl', d.baseUrl, { required: true, wide: true, placeholder: protocol.baseUrl })}
    <div class="field"><label class="field-label" for="model-auth-mode">认证方式</label><select id="model-auth-mode" data-bind="authMode"><option value="key" ${d.authMode !== 'none' ? 'selected' : ''}>API Key</option><option value="none" ${d.authMode === 'none' ? 'selected' : ''}>无需密钥（本地服务）</option></select></div>
    <div class="field wide"><label class="field-label" for="api-key">API Key <span class="pill gray">本机私有</span></label><input id="api-key" type="password" value="" autocomplete="new-password" placeholder="${d.hasKey || d.apiKey ? '已有密钥；留空表示不修改' : '输入 API Key'}"><span class="hint">Key 不进入 Git，页面不会回显。无需认证的服务可选择「无需密钥」。</span></div>
    ${field('说明', 'description', d.description, { wide: true })}
    <details class="field wide"><summary>目标软件网关与兼容选项</summary><div class="form-grid" style="margin-top:12px">
      ${field('Claude Code 的 Messages 兼容地址（可选）', 'claudeBaseUrl', d.claudeBaseUrl, { wide: true, placeholder: '网关基础地址；留空时使用兼容的主地址' })}
      ${field('Claude Code 模型 ID（可选）', 'claudeModel', d.claudeModel, { placeholder: '留空时使用上方模型 ID' })}
      ${field('Codex 的 Responses 兼容地址（可选）', 'codexBaseUrl', d.codexBaseUrl, { wide: true, placeholder: 'https://gateway.example/v1' })}
      ${field('Codex 模型 ID（可选）', 'codexModel', d.codexModel, { placeholder: '留空时使用上方模型 ID' })}
      <div class="field wide"><label class="field-label" for="model-token-parameter">Chat Completions 输出长度参数</label><select id="model-token-parameter" data-bind="tokenParameter"><option value="max_tokens" ${d.tokenParameter !== 'max_completion_tokens' ? 'selected' : ''}>max_tokens（常见兼容服务）</option><option value="max_completion_tokens" ${d.tokenParameter === 'max_completion_tokens' ? 'selected' : ''}>max_completion_tokens（要求此参数的模型）</option></select></div>
    </div><p class="small-note">网关需提供对应协议，复用此服务的 Key；使用不同 Key 时请另建模型服务。应用不内置协议转换网关。目标软件还需要流式输出与工具调用兼容，文本连接测试仅验证助手内调用。</p></details>
  </div><div class="quick-links"><button type="button" class="btn" id="model-test">测试连接</button><button type="button" class="btn" id="model-apply">应用 / 撤销自定义 API</button></div><div id="model-test-result" role="status"></div>`;
}

export function bindModelFields({ draft, api, notice, render, showModal, projects, escapeHtml }) {
  const $ = selector => document.querySelector(selector);
  $('#api-key').oninput = event => { draft.apiKey = event.target.value; };
  $('#model-protocol').onchange = event => {
    if (modelProtocols.some(item => item.baseUrl === draft.baseUrl) || !draft.baseUrl) draft.baseUrl = modelProtocols.find(item => item.id === event.target.value).baseUrl;
    draft.protocol = event.target.value;
    render();
  };
  $('#model-test').onclick = async () => {
    const button = $('#model-test'), output = $('#model-test-result');
    button.disabled = true;
    output.textContent = '正在测试连接…';
    try {
      const result = await api('model-test', 'POST', { asset: structuredClone(draft) });
      output.textContent = `连接成功：${result.text}`;
    } catch (error) { output.textContent = `连接失败：${error.message}`; }
    finally { button.disabled = false; }
  };
  $('#model-apply').onclick = () => {
    const modelId = draft.id;
    showModal('应用自定义 API', `<p class="small-note">使用已保存的模型版本。修改地址、模型或 Key 后，请先保存。预览会显示实际作用范围；确认前不会改动配置。</p><div class="form-grid">
      <div class="field"><label class="field-label" for="model-apply-software">目标软件</label><select id="model-apply-software"><option value="claude">Claude Code</option><option value="codex">Codex</option></select></div>
      <div class="field"><label class="field-label" for="model-apply-action">操作</label><select id="model-apply-action"><option value="apply">应用此模型 API</option><option value="restore">撤销助手配置，恢复原值</option></select></div>
      <div class="field wide" id="model-apply-project-field"><label class="field-label" for="model-apply-project">目标项目</label><select id="model-apply-project"><option value="">请选择项目</option>${projects.filter(project => project.directory).map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.title)}</option>`).join('')}</select></div>
      </div><p id="model-apply-scope" class="small-note"></p><div class="quick-links"><button class="btn btn-primary" id="model-apply-preview">预览配置</button></div><div id="model-apply-preview-result" role="status"></div>`);
    let generation = 0;
    const invalidate = () => {
      generation++;
      const codex = $('#model-apply-software').value === 'codex';
      $('#model-apply-project-field').hidden = codex;
      $('#model-apply-project-field').style.display = codex ? 'none' : '';
      $('#model-apply-scope').textContent = codex ? '作用范围：本机当前用户的 Codex 配置，影响使用此配置的新会话。应用后请重新启动 Codex。' : '作用范围：所选项目的 Claude Code 本机配置。应用后请重新启动 Claude Code，并检查 /status。';
      $('#model-apply-preview-result').innerHTML = '';
    };
    for (const selector of ['#model-apply-software', '#model-apply-action', '#model-apply-project']) $(selector).onchange = invalidate;
    invalidate();
    $('#model-apply-preview').onclick = async () => {
      const button = $('#model-apply-preview');
      const output = $('#model-apply-preview-result');
      const values = { modelId, software: $('#model-apply-software').value, projectId: $('#model-apply-project').value, restore: $('#model-apply-action').value === 'restore' };
      if (!values.restore && !modelId) return notice('请先保存模型服务', true);
      const current = ++generation;
      button.disabled = true;
      output.textContent = '正在读取配置…';
      try {
        const result = await api('model-application', 'POST', { ...values, preview: true });
        if (current !== generation || !output.isConnected) return;
        output.innerHTML = `<p><strong>${escapeHtml(result.scope)}</strong></p><p>${escapeHtml(result.path)}</p><details class="preview-file"><summary>当前配置</summary><pre>${escapeHtml(result.before)}</pre></details><details class="preview-file" open><summary>${result.restore ? '恢复后的配置' : '应用后的配置'}</summary><pre>${escapeHtml(result.after)}</pre></details><p class="small-note">密钥继续由本机私有存储提供。环境变量、组织策略和启动参数可能覆盖此配置。撤销只恢复本助手管理的字段。</p><div class="quick-links"><button class="btn btn-primary" id="model-apply-confirm">${result.restore ? '确认撤销' : '确认应用'}</button></div>`;
        const confirm = $('#model-apply-confirm');
        confirm.onclick = async () => {
          confirm.disabled = true;
          try {
            await api('model-application', 'POST', { ...values, token: result.token });
            if (current !== generation || !output.isConnected) return;
            output.textContent = `${result.restore ? '已恢复原 API 配置' : '已应用自定义 API'}：${result.path}。请重新启动目标软件。`;
          } catch (error) { if (current === generation) { output.textContent = error.message; notice(error.message, true); } }
        };
      } catch (error) { if (current === generation) output.textContent = error.message; }
      finally { button.disabled = false; }
    };
  };
}
