import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { modelEndpoint, modelApiRoot, modelRequest, modelText, requestModel, validateModel } from '../model-protocols.mjs';

test('四种协议：基础地址、完整地址、代理前缀与目标客户端根地址', () => {
  for (const [protocol, suffix] of [['anthropic', 'messages'], ['openai-chat', 'chat/completions'], ['openai-responses', 'responses']]) {
    for (const base of ['https://example.com', 'https://example.com/', 'https://example.com/v1', 'https://example.com/v1/']) {
      assert.equal(modelEndpoint({ protocol, baseUrl: base, model: 'test' }), `https://example.com/v1/${suffix}`);
    }
    const full = `https://example.com/proxy/v1/${suffix}`;
    assert.equal(modelEndpoint({ protocol, baseUrl: full, model: 'test' }), full);
    assert.equal(modelEndpoint({ protocol, baseUrl: 'https://example.com/proxy/v1/', model: 'test' }), full);
  }
  assert.equal(modelEndpoint({ protocol: 'openai-chat', baseUrl: 'https://example.com/v1beta/openai/', model: 'test' }), 'https://example.com/v1beta/openai/chat/completions');
  assert.equal(modelEndpoint({ protocol: 'openai-responses', baseUrl: 'https://example.com/custom-api', model: 'test' }), 'https://example.com/custom-api/responses');
  assert.throws(() => modelApiRoot({ baseUrl: 'https://example.com/custom/messages' }, 'anthropic'), /v1\/messages/);
  assert.equal(modelEndpoint({ baseUrl: 'https://example.com', model: 'old' }), 'https://example.com/v1/messages');
  assert.equal(modelEndpoint({ protocol: 'gemini', baseUrl: 'https://example.com', model: 'models/gemini-test' }), 'https://example.com/v1beta/models/gemini-test:generateContent');
  assert.equal(modelEndpoint({ protocol: 'gemini', baseUrl: 'https://example.com/proxy/v1beta/', model: 'gemini-test' }), 'https://example.com/proxy/v1beta/models/gemini-test:generateContent');
  assert.equal(modelApiRoot({ baseUrl: 'https://example.com/proxy/v1/messages' }, 'anthropic'), 'https://example.com/proxy');
  assert.equal(modelApiRoot({ baseUrl: 'https://example.com/proxy/v1/responses' }, 'openai-responses'), 'https://example.com/proxy/v1');
});

test('鉴权与请求结构遵循所选协议，支持本地无认证和不同 token 参数', () => {
  const model = { model: 'test', baseUrl: 'https://example.com' };
  const anthropic = modelRequest(model, 'private-key', 'system', 'user', 42);
  assert.equal(anthropic.headers['x-api-key'], 'private-key');
  assert.equal(anthropic.headers.authorization, undefined);
  assert.equal(anthropic.body.system, 'system');
  assert.equal(anthropic.body.max_tokens, 42);
  const chat = modelRequest({ ...model, protocol: 'openai-chat', tokenParameter: 'max_completion_tokens' }, 'private-key', 'system', 'user', 42);
  assert.equal(chat.headers.authorization, 'Bearer private-key');
  assert.equal(chat.body.max_completion_tokens, 42);
  assert.equal(chat.body.messages[0].role, 'system');
  const responses = modelRequest({ ...model, protocol: 'openai-responses' }, 'private-key', 'system', 'user', 42);
  assert.equal(responses.body.instructions, 'system');
  assert.equal(responses.body.input, 'user');
  assert.equal(responses.body.max_output_tokens, 42);
  const gemini = modelRequest({ ...model, protocol: 'gemini' }, 'private-key', 'system', 'user', 42);
  assert.equal(gemini.headers['x-goog-api-key'], 'private-key');
  assert.equal(gemini.body.systemInstruction.parts[0].text, 'system');
  assert.equal(gemini.body.generationConfig.maxOutputTokens, 42);
  const anonymous = modelRequest({ ...model, authMode: 'none' }, 'ignored', '', '', 42);
  assert.equal(anonymous.headers['x-api-key'], undefined);
  assert.throws(() => modelRequest(model, '', '', '', 42), /API Key/);
  for (const baseUrl of ['file:///tmp/key', 'https://user:pass@example.com', 'https://example.com?key=secret']) assert.throws(() => validateModel({ ...model, baseUrl }));
  assert.throws(() => validateModel({ ...model, protocol: 'made-up' }), /不支持/);
});

test('文本解析不混入思考内容，并显式拒绝截断、拒答及空响应', () => {
  assert.equal(modelText({}, { content: [{ type: 'thinking', thinking: 'secret' }, { type: 'text', text: 'hello' }] }), 'hello');
  assert.equal(modelText({ protocol: 'openai-chat' }, { choices: [{ message: { content: [{ type: 'text', text: 'hello' }] } }] }), 'hello');
  assert.equal(modelText({ protocol: 'openai-responses' }, { output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: 'hello' }] }] }), 'hello');
  assert.equal(modelText({ protocol: 'gemini' }, { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'thinking' }, { text: 'hello' }] } }] }), 'hello');
  for (const [protocol, body] of [
    ['anthropic', { stop_reason: 'max_tokens' }], ['openai-chat', { choices: [{ finish_reason: 'length' }] }],
    ['openai-responses', { status: 'incomplete' }], ['gemini', { candidates: [{ finishReason: 'MAX_TOKENS' }] }]
  ]) assert.throws(() => modelText({ protocol }, body), /上限|未完成/);
  for (const protocol of ['anthropic', 'openai-chat', 'openai-responses', 'gemini']) assert.throws(() => modelText({ protocol }, {}), /未返回可用文本/);
  assert.throws(() => modelText({ protocol: 'openai-chat' }, { choices: [{ message: { refusal: 'no' } }] }), /拒绝/);
  assert.throws(() => modelText({ protocol: 'gemini' }, { promptFeedback: { blockReason: 'SAFETY' } }), /安全策略/);
});

test('HTTP 调用验证各协议，并保留错误信息、隐藏密钥、识别非 JSON', async t => {
  let responseBody = {}, status = 200, received;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    received = { url: req.url, headers: req.headers, body: JSON.parse(raw) };
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cases = [
    ['anthropic', { content: [{ type: 'text', text: 'OK' }] }, '/v1/messages'],
    ['openai-chat', { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }, '/v1/chat/completions'],
    ['openai-responses', { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }, '/v1/responses'],
    ['gemini', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] }, '/v1beta/models/test:generateContent']
  ];
  for (const [protocol, body, url] of cases) {
    responseBody = body;
    assert.equal(await requestModel({ protocol, baseUrl, model: 'test' }, 'private-key', 'system', 'user'), 'OK');
    assert.equal(received.url, url);
  }
  status = 401; responseBody = { error: { message: 'invalid private-key' } };
  await assert.rejects(requestModel({ baseUrl, model: 'test' }, 'private-key', '', ''), error => /401/.test(error.message) && !error.message.includes('private-key'));
  status = 400; responseBody = { detail: 'Model is not supported: private-key' };
  await assert.rejects(requestModel({ baseUrl, model: 'test' }, 'private-key', '', ''), error => /Model is not supported/.test(error.message) && !error.message.includes('private-key'));
  status = 200; responseBody = '<html>wrong endpoint</html>';
  await assert.rejects(requestModel({ baseUrl, model: 'test' }, 'private-key', '', ''), /不是有效 JSON/);
});
