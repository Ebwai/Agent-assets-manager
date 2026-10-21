import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

test('模型服务端到端：草稿测试、版本密钥隔离、AI 复用、两种软件配置与撤销', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-services-'));
  const data = path.join(temp, 'data'), codexHome = path.join(temp, 'codex'), projectDir = path.join(temp, 'project');
  fs.mkdirSync(projectDir); fs.mkdirSync(codexHome);
  let protocol = 'openai-chat', received;
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'test' }, { id: 'other' }] })); return; }
    received = { url: req.url, headers: req.headers, body: JSON.parse(raw) };
    const response = protocol === 'anthropic' ? { content: [{ type: 'text', text: 'OK' }] } : protocol === 'openai-chat' ? { choices: [{ message: { content: 'OK' } }] } : protocol === 'openai-responses' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] } : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(response));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: path.resolve('.'), env: { ...process.env, ASSET_DATA_DIR: data, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: path.join(temp, 'claude'), PORT: String(port) }, stdio: 'pipe' });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    child.kill(); if (child.exitCode === null) await once(child, 'exit');
    await new Promise(resolve => upstream.close(resolve));
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(temp, { recursive: true, force: true });
  });
  const request = async (endpoint, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/${endpoint}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
  };
  let ready = false;
  for (let i = 0; i < 100; i++) { try { await request('bootstrap'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 80)); } }
  assert.ok(ready, stderr);
  const baseUrl = `http://127.0.0.1:${upstream.address().port}`;
  const draft = { title: '新模型', model: 'test', protocol, baseUrl, apiKey: 'integration-private-key' };
  assert.equal((await request('model-test', { asset: draft })).text, 'OK');
  const initialModels = (await request('bootstrap')).assets.model;
  assert.equal(initialModels.length, 1); assert.equal(initialModels[0].id, 'a120b070-2026-4022-8000-000000000001'); assert.equal(initialModels[0].hasKey, false);
  const model = await request('model', { asset: draft, message: '保存多协议模型' });
  assert.equal(model.protocol, protocol); assert.equal(model.apiKey, undefined); assert.equal(model.hasKey, true);
  const definition = fs.readFileSync(path.join(data, 'repo', 'assets', 'model', `${model.id}.json`), 'utf8');
  assert.ok(!definition.includes('integration-private-key'));
  assert.equal((await request('model-test', { asset: { ...model, apiKey: '' } })).text, 'OK');
  assert.equal(received.headers.authorization, 'Bearer integration-private-key');
  const skill = await request('skill', { asset: { title: '模型测试 Skill', variants: { common: { frontmatter: { name: 'model-test', description: '检查输入。' }, body: '检查输入。' } }, files: {} }, message: '添加测试 Skill' });
  assert.equal((await request('ai/review', { modelId: model.id, skillId: skill.id })).text, 'OK');
  assert.equal(received.url, '/v1/chat/completions');
  assert.deepEqual(model.models, ['test']); assert.equal(model.aiModel, 'test');
  assert.deepEqual((await request('model-discovery', { asset: { ...model, apiKey: '' } })).models, ['test', 'other']);
  const multi = await request('model', { asset: { ...model, models: ['test', 'other'], aiModel: 'other', apiKey: '' }, message: '设置供应商多模型' });
  assert.equal(multi.model, 'other');
  await request('ai/review', { modelId: multi.id, skillId: skill.id }); assert.equal(received.body.model, 'other');
  await assert.rejects(request('model', { asset: { ...draft, protocol: 'unknown' }, message: '拒绝未知协议' }), /不支持/);
  await assert.rejects(request('model-application', { modelId: model.id, software: 'codex', preview: true }), /Responses/);
  for (const selected of ['anthropic', 'openai-responses', 'gemini']) {
    protocol = selected;
    const tested = await request('model-test', { asset: { ...draft, protocol: selected } }); assert.equal(tested.text, 'OK');
  }
  const project = await request('project', { asset: { title: 'API 项目', directory: projectDir }, message: '登记项目' });
  const gateway = await request('model', { asset: { ...multi, apiKey: '', claudeBaseUrl: baseUrl, codexBaseUrl: `${baseUrl}/v1` }, message: '登记目标端点' });
  for (const software of ['claude', 'codex']) {
    const body = { modelId: gateway.id, software, selectedModel: 'test', modelMapping: { claude: { opus: 'other' }, models: [{ id: 'test', label: '首选' }, { id: 'other' }] } };
    const preview = await request('model-application', { ...body, preview: true });
    assert.ok(!JSON.stringify(preview).includes('integration-private-key'));
    assert.equal(fs.existsSync(preview.path), false);
    assert.match(preview.scope, /当前用户/);
    await request('model-application', { ...body, token: preview.token }); assert.equal(fs.existsSync(preview.path), true);
    assert.match(fs.readFileSync(preview.path, 'utf8'), /test/);
    const state = await request('model-application-state?modelId=' + gateway.id);
    assert.equal(state[software].modelMapping.claude.opus, 'other');
    assert.equal(state[software].selectedModel, 'test');
    if (software === 'codex') assert.equal(JSON.parse(fs.readFileSync(preview.additionalFiles[0].path)).models[0].display_name, '首选 (test)');
    assert.equal((await request('model/' + gateway.id)).aiModel, 'other');
    assert.equal(fs.existsSync(path.join(projectDir, '.claude', 'settings.local.json')), false);
    const restore = { software, projectId: project.id, restore: true };
    const undo = await request('model-application', { ...restore, preview: true });
    await request('model-application', { ...restore, token: undo.token }); assert.equal(fs.existsSync(preview.path), false);
  }
  const page = await fetch(`http://127.0.0.1:${port}/model-config.js`); assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /javascript/);
});
