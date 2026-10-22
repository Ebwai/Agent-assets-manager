import fs from 'node:fs';
import path from 'node:path';

// Codex 0.163.0 subscription model catalog, fetched 2026-10-22.
// These are full context windows, not max output tokens or the API's advertised ceiling.
const subscriptionWindows = [
  ['gpt-6.1-sol', 500000],
  ['gpt-6-astra', 272000],
  ['gpt-6-sol', 272000],
  ['gpt-6-luna', 272000],
  ['gpt-5.6-sol', 272000],
  ['gpt-5.6-terra', 272000],
  ['gpt-5.6-luna', 272000]
];

export const companyModelPreset = Object.freeze({
  id: 'a120b070-2026-4022-8000-000000000001', title: 'AI2RobCoWork', protocol: 'openai-responses',
  baseUrl: 'https://ai2robcowork.site/openai/v1', authMode: 'key',
  model: 'gpt-6.1-sol', aiModel: 'gpt-6.1-sol', models: subscriptionWindows.map(([id]) => id),
  modelCapabilities: subscriptionWindows.map(([id, contextWindow]) => ({ id, contextWindow, reasoning: 'standard' })),
  description: 'AI2Robot 公司定制版预置服务。请填写自己的 API Key；默认 gpt-6.1-sol。完整上下文参考 2026-10-22 Codex 订阅目录：6.1 Sol 500000，其余预置模型 272000 tokens；不是单次输出上限。实际权限与容量以中转供应商为准，可在模型配置中调整。'
});

export function installCompanyPreset({ privateDir, services, save, canSave }) {
  const marker = path.join(privateDir, 'ai2robot-preset-installed.json');
  if (fs.existsSync(marker)) return;
  const existing = services.find(service => service.id === companyModelPreset.id || String(service.baseUrl || '').replace(/\/+$/, '') === companyModelPreset.baseUrl);
  if (!existing && !canSave()) return;
  const model = existing || save(structuredClone(companyModelPreset));
  fs.mkdirSync(privateDir, { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ version: 1, modelId: model.id }) + '\n', { mode: 0o600 });
}
