import { spawnSync } from 'node:child_process';
import { modelEndpoint, apiUrl } from './model-protocols.mjs';
import { modelProtocol, aiModelId } from './public/model-protocols.js';

export function parseModelList(payload, protocol) {
  let value = payload;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof value === 'string') { value = JSON.parse(value); continue; }
    if (typeof value?.output_text === 'string') { value = JSON.parse(value.output_text); continue; }
    break;
  }
  const records = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : value?.models;
  if (!Array.isArray(records)) throw new Error('服务未返回可识别的模型列表，请手工填写模型 ID');
  const models = [...new Set(records.filter(item => typeof item === 'string' || item && item.visibility !== 'hide' && item.supported_in_api !== false && (!item.supportedGenerationMethods || item.supportedGenerationMethods.includes('generateContent'))).map(item => typeof item === 'string' ? item : item.id || item.slug || item.name).filter(id => typeof id === 'string').map(id => protocol === 'gemini' ? id.replace(/^models\//, '') : id).map(id => id.trim()).filter(Boolean))];
  return { models, nextPageToken: value?.nextPageToken, afterId: value?.has_more ? value.last_id : null };
}

export function modelListEndpoint(service) {
  apiUrl(service.baseUrl);
  const protocol = modelProtocol(service);
  const endpoint = new URL(modelEndpoint({ ...service, model: aiModelId(service) || 'catalog' }));
  endpoint.pathname = protocol === 'gemini' ? endpoint.pathname.replace(/\/models\/[^/]+:generateContent$/, '/models') : protocol === 'anthropic' ? endpoint.pathname.replace(/\/messages$/, '/models') : protocol === 'openai-chat' ? endpoint.pathname.replace(/\/chat\/completions$/, '/models') : endpoint.pathname.replace(/\/responses$/, '/models');
  return endpoint;
}

function localCodexVersion() {
  const result = spawnSync(process.platform === 'win32' ? 'codex.exe' : 'codex', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  return result.status === 0 ? result.stdout.trim().replace(/^codex-cli\s+/, '') : '';
}

export async function discoverModels(service, key, { clientVersion = localCodexVersion } = {}) {
  const protocol = modelProtocol(service), url = modelListEndpoint(service);
  const headers = { accept: 'application/json' };
  if (service.authMode !== 'none') {
    if (!key) throw new Error('请先填写或保存 API Key');
    if (protocol === 'anthropic') headers['x-api-key'] = key;
    else if (protocol === 'gemini') headers['x-goog-api-key'] = key;
    else headers.authorization = `Bearer ${key}`;
  }
  if (protocol === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  const redact = value => key ? String(value).replaceAll(key, '[密钥已隐藏]') : String(value);
  const signal = AbortSignal.timeout(30000), ids = new Set();
  let versionRetried = false;
  try {
    for (let page = 0; page < 21; page++) {
      if (page === 20) throw new Error('服务的模型列表分页过多，请手工维护需要的模型');
      const response = await fetch(url, { headers, signal, redirect: 'error' });
      let body;
      try { body = await response.json(); } catch { throw new Error(`模型列表返回 ${response.status}，响应不是有效 JSON`); }
      const detail = typeof body?.detail === 'string' ? body.detail : typeof body?.error === 'string' ? body.error : body?.error?.message || body?.message || JSON.stringify(body?.detail || '请求失败');
      if (response.status === 400 && !versionRetried && /client_version/.test(detail)) {
        const version = typeof clientVersion === 'function' ? clientVersion() : clientVersion;
        if (!version) throw new Error('服务要求 Codex client_version，但本机未检测到 Codex；请手工填写模型列表');
        url.searchParams.set('client_version', version); versionRetried = true; page--; continue;
      }
      if (!response.ok || body?.error) throw new Error(`模型列表返回 ${response.status}：${redact(detail).slice(0, 250)}`);
      const parsed = parseModelList(body, protocol);
      for (const id of parsed.models) ids.add(id);
      if (ids.size > 5000) throw new Error('模型超过 5000 个，请手工维护需要的模型');
      if (parsed.nextPageToken) url.searchParams.set('pageToken', parsed.nextPageToken);
      else if (parsed.afterId) url.searchParams.set('after_id', parsed.afterId);
      else {
        const models = [...ids];
        if (!models.length) throw new Error('服务未返回可用模型，请手工填写模型 ID');
        if (key && models.some(id => id.includes(key))) throw new Error('模型列表包含敏感信息，已停止导入');
        return { models };
      }
    }
  } catch (error) {
    if (['AbortError', 'TimeoutError'].includes(error.name)) throw new Error('获取模型列表超时，请重试或手工维护');
    throw new Error(redact(error.message));
  }
}
