import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelService, normalizeModelCapability } from '../public/model-protocols.js';
import { normalizeApplicationMapping } from '../public/model-mapping.js';
import { codexModelCatalog } from '../model-catalog.mjs';

test('支持模态默认文本和图片，兼容旧资产，显式关闭优先', () => {
  const service = { model: 'gpt-6.1-sol', models: ['gpt-6.1-sol', 'text-only'], modelCapabilities: [{ id: 'gpt-6.1-sol', contextWindow: 500000 }, { id: 'text-only', imageInput: false }] };
  const mapping = normalizeApplicationMapping(normalizeModelService(service), service.model, { models: service.models.map(id => ({ id, imageInput: false })) });
  assert.deepEqual(JSON.parse(codexModelCatalog(mapping)).models.map(row => row.input_modalities), [['text', 'image'], ['text']]);
  service.modelCapabilities[0].imageInput = false;
  assert.deepEqual(JSON.parse(codexModelCatalog(normalizeApplicationMapping(service, service.model))).models[0].input_modalities, ['text']);
  assert.throws(() => normalizeModelCapability({ imageInput: 'true' }), /图片输入/);
  assert.equal(normalizeModelCapability({ id: 'unknown', imageInput: true }).imageInput, true);
  assert.equal(normalizeApplicationMapping({ ...service, modelCapabilities: undefined }, service.model).models[0].imageInput, true);
});
