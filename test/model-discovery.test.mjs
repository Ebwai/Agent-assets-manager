import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { parseModelList, modelListEndpoint, discoverModels } from '../model-discovery.mjs';
import { normalizeModelService } from '../public/model-protocols.js';
import { modelRequest } from '../model-protocols.mjs';

test('供应商规范化兼容单模型，AI 辅助模型必须属于列表且不改服务身份', () => {
  const legacy = { id: 'service-id', model: 'legacy', baseUrl: 'https://example.com' };
  assert.deepEqual(normalizeModelService(legacy), { ...legacy, models: ['legacy'], aiModel: 'legacy' });
  assert.equal(legacy.aiModel, undefined);
  const service = normalizeModelService({ ...legacy, models: [' a ', 'b', 'a'], aiModel: 'b' });
  assert.deepEqual(service.models, ['a', 'b']); assert.equal(service.model, 'b'); assert.equal(service.id, legacy.id);
  assert.throws(() => normalizeModelService({ ...legacy, models: ['a'], aiModel: 'b' }), /AI 辅助/);
  assert.throws(() => normalizeModelService({ ...legacy, models: [] }), /模型列表/);
  assert.throws(() => normalizeModelService({ ...legacy, models: [42] }), /模型 ID 数组/);
  const request = modelRequest({ ...service, model: 'a', protocol: 'openai-responses' }, 'key', 'system', 'user', 100);
  assert.equal(request.body.model, 'b');
});

test('目录格式兼容常见列表、Codex JSON 封装与 Gemini 文本模型过滤', () => {
  assert.deepEqual(parseModelList({ data: [{ id: 'one' }, { id: 'two' }, { id: 'one' }] }, 'openai-chat').models, ['one', 'two']);
  assert.deepEqual(parseModelList({ output_text: JSON.stringify({ models: [{ slug: 'one' }, { slug: 'hidden', visibility: 'hide' }, { slug: 'disabled', supported_in_api: false }] }) }, 'openai-responses').models, ['one']);
  assert.deepEqual(parseModelList({ models: [{ name: 'models/gemini', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next' }, 'gemini'), { models: ['gemini'], nextPageToken: 'next', afterId: null });
  assert.throws(() => parseModelList({ message: 'not a catalog' }, 'anthropic'), /手工填写/);
});

test('目录地址与调用地址分开，不要求先指定 AI 模型', () => {
  for (const [protocol, baseUrl, expected] of [
    ['anthropic', 'https://example.com/prefix/v1/messages', 'https://example.com/prefix/v1/models'],
    ['openai-chat', 'https://example.com/v1beta/openai', 'https://example.com/v1beta/openai/models'],
    ['openai-responses', 'https://example.com/openai/v1', 'https://example.com/openai/v1/models'],
    ['gemini', 'https://example.com/v1beta', 'https://example.com/v1beta/models']
  ]) assert.equal(modelListEndpoint({ protocol, baseUrl }).href, expected);
});

test('目录 HTTP：按服务要求补 client_version、分页合并、使用对应认证', async t => {
  const received = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local'); received.push({ url, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    if (!url.searchParams.has('client_version')) { res.writeHead(400); res.end(JSON.stringify({ detail: "query 'client_version' required" })); return; }
    res.end(JSON.stringify({ output_text: JSON.stringify(url.searchParams.has('after_id') ? { models: [{ slug: 'second' }, { slug: 'first' }] } : { models: [{ slug: 'first' }], has_more: true, last_id: 'first' }) }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await discoverModels({ protocol: 'openai-responses', baseUrl: `http://127.0.0.1:${server.address().port}/openai/v1` }, 'private-key', { clientVersion: () => 'test-version' });
  assert.deepEqual(result.models, ['first', 'second']); assert.equal(received.length, 3);
  assert.equal(received[0].url.pathname, '/openai/v1/models'); assert.equal(received[1].url.searchParams.get('client_version'), 'test-version');
  assert.equal(received[2].url.searchParams.get('after_id'), 'first'); assert.equal(received[0].headers.authorization, 'Bearer private-key');
});

test('目录失败保留远端原因并隐藏凭据，不自动猜模型', async t => {
  const server = http.createServer((req, res) => { res.writeHead(403, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'denied private-key' } })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const service = { protocol: 'anthropic', baseUrl: `http://127.0.0.1:${server.address().port}` };
  await assert.rejects(discoverModels(service, 'private-key'), error => /403/.test(error.message) && !error.message.includes('private-key'));
  await assert.rejects(discoverModels(service, ''), /API Key/);
});
