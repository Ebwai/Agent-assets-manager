import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { companyModelPreset, installCompanyPreset } from '../company-preset.mjs';
import { normalizeModelService } from '../public/model-protocols.js';
import { normalizeApplicationMapping } from '../public/model-mapping.js';
import { codexModelCatalog } from '../model-catalog.mjs';

function setup(t) {
  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai2robot-preset-'));
  t.after(() => { assert.ok(path.resolve(privateDir).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(privateDir, { recursive: true, force: true }); });
  return privateDir;
}

test('公司预置使用示例地址、Responses 和模型，未包含密钥；仅安装一次，不重建删除项', t => {
  const privateDir = setup(t), saved = [];
  const args = { privateDir, services: [], canSave: () => true, save: preset => { saved.push(preset); return preset; } };
  installCompanyPreset(args); installCompanyPreset(args);
  assert.equal(saved.length, 1); assert.equal(saved[0].baseUrl, 'https://ai2robcowork.site/openai/v1');
  assert.equal(saved[0].protocol, 'openai-responses'); assert.equal(saved[0].model, 'gpt-6.1-sol');
  assert.equal(saved[0].apiKey, undefined); assert.equal(saved[0].authMode, 'key');
  assert.ok(!JSON.stringify(companyModelPreset).includes('sk-'));
});

test('公司模型完整上下文沿用订阅目录，投影保持总窗口而非单次输出值', () => {
  const service = normalizeModelService(structuredClone(companyModelPreset));
  const mapping = normalizeApplicationMapping(service, service.model);
  const catalog = JSON.parse(codexModelCatalog(mapping));
  assert.equal(service.models.length, 7);
  assert.deepEqual(catalog.models.map(row => [row.slug, row.context_window]), [
    ['gpt-6.1-sol', 500000], ['gpt-6-astra', 272000], ['gpt-6-sol', 272000],
    ['gpt-6-luna', 272000], ['gpt-5.6-sol', 272000], ['gpt-5.6-terra', 272000], ['gpt-5.6-luna', 272000]
  ]);
  assert.ok(catalog.models.every(row => row.effective_context_window_percent === 95));
  service.modelCapabilities[0].contextWindow = 1000000;
  assert.equal(normalizeApplicationMapping(service, service.model).models[0].contextWindow, 1000000);
  assert.equal(companyModelPreset.modelCapabilities[0].contextWindow, 500000);
});

test('已有服务原样保留，不改模型、密钥或身份；脏资产库不自动提交', t => {
  const privateDir = setup(t), existing = { id: 'existing-service', baseUrl: companyModelPreset.baseUrl + '/', model: 'gpt-6-luna' };
  installCompanyPreset({ privateDir, services: [existing], canSave: () => false, save: () => assert.fail('不得覆盖已有服务') });
  assert.equal(existing.model, 'gpt-6-luna');
  assert.equal(JSON.parse(fs.readFileSync(path.join(privateDir, 'ai2robot-preset-installed.json'))).modelId, existing.id);
  const otherDir = path.join(privateDir, 'dirty');
  installCompanyPreset({ privateDir: otherDir, services: [], canSave: () => false, save: () => assert.fail('不得提交脏工作区') });
  assert.equal(fs.existsSync(otherDir), false);
});
