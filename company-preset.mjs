import fs from 'node:fs';
import path from 'node:path';

export const companyModelPreset = Object.freeze({
  id: 'a120b070-2026-4022-8000-000000000001', title: 'AI2RobCoWork', protocol: 'openai-responses',
  baseUrl: 'https://ai2robcowork.site/openai/v1', authMode: 'key',
  model: 'gpt-6.1-sol', aiModel: 'gpt-6.1-sol', models: ['gpt-6.1-sol'],
  description: 'AI2Robot 公司定制版预置服务。请填写自己的 API Key；默认模型为 gpt-6.1-sol，实际权限以供应商为准，可获取模型列表后重新选择。'
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
