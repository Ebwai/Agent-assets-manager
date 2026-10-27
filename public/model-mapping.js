import { serviceModelIds, normalizeModelCapability } from './model-protocols.js';

export const claudeModelSlots = [
  ['sonnet', 'Sonnet（日常）', 'ANTHROPIC_DEFAULT_SONNET_MODEL'],
  ['opus', 'Opus（规划）', 'ANTHROPIC_DEFAULT_OPUS_MODEL'],
  ['haiku', 'Haiku（快速／后台）', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'],
  ['fable', 'Fable', 'ANTHROPIC_DEFAULT_FABLE_MODEL'],
  ['subagent', '子任务默认模型', 'CLAUDE_CODE_SUBAGENT_MODEL']
];

export function normalizeApplicationMapping(service, selectedModel, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('模型映射配置无效');
  const ids = serviceModelIds(service);
  const requireId = id => {
    if (typeof id !== 'string' || !ids.includes(id)) throw new Error('映射目标必须来自供应商已保存的模型列表');
    return id;
  };
  requireId(selectedModel);
  const rows = input.models ?? ids.map(id => ({ id }));
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new Error('请选择至少一个模型加入目标软件列表');
  const models = rows.map(row => {
    if (!row || typeof row !== 'object') throw new Error('模型列表行无效');
    const id = requireId(row.id), label = row.label === undefined ? id : row.label;
    if (typeof label !== 'string' || !label.trim() || label.length > 200 || /[\r\n\t]/.test(label)) throw new Error('模型显示名称需为 1–200 个字符');
    // Saved model capabilities own these values; legacy application rows are fallback only.
    const { contextWindow, reasoning, imageInput } = normalizeModelCapability({ id, ...(service.modelCapabilities !== undefined ? service.modelCapabilities.find(item => item.id === id) : row) });
    return { id, label: label.trim(), contextWindow, reasoning, imageInput };
  });
  if (new Set(models.map(row => row.id)).size !== models.length) throw new Error('目标软件模型列表不能重复');
  if (!models.some(row => row.id === selectedModel)) throw new Error('默认模型必须包含在目标软件列表中');
  const claude = Object.fromEntries(claudeModelSlots.map(([slot]) => [slot, requireId(input.claude?.[slot] ?? selectedModel)]));
  const overrides = input.overrides ?? {};
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).length > 100) throw new Error('Claude 版本映射无效');
  for (const [source, id] of Object.entries(overrides)) {
    if (!/^claude-[a-zA-Z0-9.-]{1,100}$/.test(source)) throw new Error('版本映射左侧需为完整 Claude 模型 ID');
    requireId(id);
  }
  return { models, claude, overrides: { ...overrides }, reviewModel: requireId(input.reviewModel ?? selectedModel) };
}
