export const modelProtocols = [
  { id: 'anthropic', name: 'Anthropic Messages', baseUrl: 'https://api.anthropic.com', example: 'claude-sonnet-4-5' },
  { id: 'openai-chat', name: 'OpenAI Chat Completions', baseUrl: 'https://api.openai.com/v1', example: '服务商提供的模型 ID' },
  { id: 'openai-responses', name: 'OpenAI Responses', baseUrl: 'https://api.openai.com/v1', example: '服务商提供的模型 ID' },
  { id: 'gemini', name: 'Gemini generateContent', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', example: 'gemini-2.5-flash' }
];

export function modelProtocol(model) {
  return model.protocol || 'anthropic';
}

export function aiModelId(service) {
  return typeof service.aiModel === 'string' ? service.aiModel.trim() : String(service.model || '').trim();
}

export function serviceModelIds(service) {
  const values = Array.isArray(service.models) ? service.models : [aiModelId(service), service.claudeModel, service.codexModel];
  return [...new Set(values.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))];
}

export function normalizeModelService(service) {
  if (service.models !== undefined && (!Array.isArray(service.models) || service.models.some(value => typeof value !== 'string'))) throw new Error('模型列表需为模型 ID 数组');
  const models = serviceModelIds(service), aiModel = aiModelId(service);
  if (!models.length || models.length > 5000 || models.some(id => id.length > 512 || /[\r\n\t]/.test(id))) throw new Error('模型列表需包含 1–5000 个有效模型 ID');
  if (!aiModel || !models.includes(aiModel)) throw new Error('请从模型列表中选择资产 AI 辅助模型');
  // Preserve the existing model field and service identity for asset/profile compatibility.
  const modelCapabilities = service.modelCapabilities;
  if (modelCapabilities !== undefined) {
    if (!Array.isArray(modelCapabilities) || modelCapabilities.length > 5000) throw new Error('模型能力配置无效');
    const seen = new Set();
    for (const row of modelCapabilities) {
      if (!row || !models.includes(row.id) || seen.has(row.id)) throw new Error('模型能力必须对应不重复的模型 ID');
      seen.add(row.id); normalizeModelCapability(row);
    }
  }
  return { ...service, models, aiModel, model: aiModel };
}

export function normalizeModelCapability(row = {}) {
  const contextWindow = row.contextWindow ?? 32768, reasoning = row.reasoning ?? 'none';
  if (!Number.isInteger(contextWindow) || contextWindow < 4096 || contextWindow > 2000000) throw new Error('上下文窗口需为 4096–2000000 的整数');
  if (!['none', 'standard'].includes(reasoning)) throw new Error('推理能力配置无效');
  return { contextWindow, reasoning };
}
