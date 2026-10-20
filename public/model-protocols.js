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
  return { ...service, models, aiModel, model: aiModel };
}
