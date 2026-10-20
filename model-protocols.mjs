import { modelProtocols, modelProtocol } from './public/model-protocols.js';

export function apiUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写有效的 API 地址'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API 地址必须是 HTTP 或 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含账号、密码、查询参数或片段；请将密钥填入 API Key');
  return url;
}

export function validateModel(model) {
  if (!modelProtocols.some(item => item.id === modelProtocol(model))) throw new Error('不支持的 API 协议，请选择协议或使用兼容网关');
  apiUrl(model.baseUrl);
  if (typeof model.model !== 'string' || !model.model.trim()) throw new Error('请填写模型 ID');
  if (model.authMode !== undefined && !['key', 'none'].includes(model.authMode)) throw new Error('认证方式无效');
  if (model.tokenParameter !== undefined && !['max_tokens', 'max_completion_tokens'].includes(model.tokenParameter)) throw new Error('输出长度参数无效');
  for (const name of ['claudeBaseUrl', 'codexBaseUrl']) if (model[name]) apiUrl(model[name]);
  for (const name of ['claudeModel', 'codexModel']) if (model[name] !== undefined && typeof model[name] !== 'string') throw new Error('目标软件模型 ID 无效');
}

// Full endpoints are accepted as well as API roots, including custom proxy prefixes.
export function modelEndpoint(model, protocol = modelProtocol(model)) {
  const url = apiUrl(model.baseUrl);
  let base = url.pathname.replace(/\/+$/, '');
  const suffix = { anthropic: '/messages', 'openai-chat': '/chat/completions', 'openai-responses': '/responses' }[protocol];
  if (suffix) {
    if (!base.endsWith(suffix)) {
      const version = protocol === 'anthropic' ? (/\/v\d+(?:beta\d*)?$/.test(base) ? '' : '/v1') : (base ? '' : '/v1');
      base += `${version}${suffix}`;
    }
  } else if (protocol === 'gemini') {
    if (!/\/models\/[^/]+:generateContent$/.test(base)) {
      if (!/\/v\d+(?:beta\d*)?$/.test(base)) base += '/v1beta';
      base += `/models/${encodeURIComponent(model.model.replace(/^models\//, ''))}:generateContent`;
    }
  } else throw new Error('不支持的 API 协议');
  url.pathname = base;
  return url.href;
}

export function modelApiRoot(model, protocol) {
  const url = new URL(modelEndpoint(model, protocol));
  if (protocol === 'anthropic' && !url.pathname.endsWith('/v1/messages')) throw new Error('Claude Code 的兼容端点需使用 /v1/messages 路径，请填写对应网关的基础地址');
  const suffix = protocol === 'anthropic' ? '/messages' : '/responses';
  url.pathname = url.pathname.slice(0, -suffix.length);
  // Claude's client appends /v1/messages; OpenAI clients append /responses.
  if (protocol === 'anthropic') url.pathname = url.pathname.replace(/\/v1$/, '') || '/';
  return url.href.replace(/\/$/, '');
}

export function modelRequest(model, key, system, user, maxTokens) {
  validateModel(model);
  if (model.authMode !== 'none' && !key) throw new Error('请先保存 API Key，或为无需认证的本地服务选择「无需密钥」');
  const protocol = modelProtocol(model);
  const headers = { 'content-type': 'application/json' };
  if (model.authMode !== 'none') {
    if (protocol === 'anthropic') headers['x-api-key'] = key;
    else if (protocol === 'gemini') headers['x-goog-api-key'] = key;
    else headers.authorization = `Bearer ${key}`;
  }
  let body;
  if (protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    body = { model: model.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
  } else if (protocol === 'openai-chat') {
    body = { model: model.model, [model.tokenParameter || 'max_tokens']: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: false };
  } else if (protocol === 'openai-responses') {
    body = { model: model.model, instructions: system, input: user, max_output_tokens: maxTokens, stream: false };
  } else {
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } };
  }
  return { url: modelEndpoint(model), headers, body };
}

export function modelText(model, body) {
  const protocol = modelProtocol(model);
  let text = '';
  if (protocol === 'anthropic') {
    if (body.stop_reason === 'max_tokens') throw new Error('模型输出达到长度上限，请精简输入或更换模型');
    text = (Array.isArray(body.content) ? body.content : []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  } else if (protocol === 'openai-chat') {
    const choice = body.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('模型输出达到长度上限，请精简输入或更换模型');
    if (choice?.message?.refusal) throw new Error('模型拒绝了本次请求');
    const content = choice?.message?.content;
    text = typeof content === 'string' ? content : (Array.isArray(content) ? content : []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  } else if (protocol === 'openai-responses') {
    if (body.status === 'incomplete') throw new Error('模型输出未完成，请精简输入或更换模型');
    if (body.error || body.status === 'failed') throw new Error('模型返回失败状态');
    const parts = (Array.isArray(body.output) ? body.output : []).flatMap(item => item.content || []);
    if (parts.some(part => part.type === 'refusal')) throw new Error('模型拒绝了本次请求');
    text = parts.filter(part => part.type === 'output_text').map(part => part.text).join('\n') || body.output_text || '';
  } else {
    const candidate = body.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('模型输出达到长度上限，请精简输入或更换模型');
    if (body.promptFeedback?.blockReason || (candidate?.finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(candidate.finishReason))) throw new Error('模型未能生成可用内容，可能被安全策略阻止');
    text = (candidate?.content?.parts || []).filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('\n');
  }
  if (typeof text !== 'string' || !text.trim()) throw new Error('模型未返回可用文本，请检查所选协议、模型 ID 和服务能力');
  return text;
}

export async function requestModel(model, key, system, user, maxTokens = 3000) {
  const request = modelRequest(model, key, system, user, maxTokens);
  const redact = value => key ? String(value).replaceAll(key, '[密钥已隐藏]') : String(value);
  try {
    const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(90000), redirect: 'error' });
    let body;
    try { body = await response.json(); } catch { throw new Error(`模型服务返回 ${response.status}，响应不是有效 JSON；请检查 API 地址和协议`); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('模型服务未返回有效的响应对象，请检查 API 地址和协议');
    const detail = typeof body.error === 'string' ? body.error : body.error?.message || body.message || (typeof body.detail === 'string' ? body.detail : body.detail ? JSON.stringify(body.detail) : '请求失败');
    if (!response.ok || body.error) throw new Error(`模型服务返回 ${response.status}：${redact(detail).slice(0, 250)}`);
    return redact(modelText(model, body));
  } catch (error) {
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('模型请求超时（90 秒），请检查服务后重试');
    throw new Error(redact(error.message));
  }
}
