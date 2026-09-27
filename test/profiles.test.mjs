import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

test('同一资产按 Harness 和模型保存配置，生效时匹配对应组合', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-profiles-test-'));
  const projectDir = path.join(temp, 'project');
  fs.mkdirSync(projectDir);
  const port = 40000 + Math.floor(Math.random() * 15000);
  const server = spawn(process.execPath, ['server.mjs'], { cwd: path.resolve('.'), env: { ...process.env, ASSET_DATA_DIR: path.join(temp, 'data'), PORT: String(port) }, stdio: 'pipe' });
  t.after(() => { server.kill(); fs.rmSync(temp, { recursive: true, force: true }); });
  const request = async (url, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { await request('bootstrap'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(ready, 'server started');
  const modelA = await request('model', 'POST', { message: '配置模型 A', asset: { title: '模型 A', model: 'model-a', baseUrl: 'https://api.anthropic.com' } });
  const modelB = await request('model', 'POST', { message: '配置模型 B', asset: { title: '模型 B', model: 'model-b', baseUrl: 'https://api.anthropic.com' } });
  const project = await request('project', 'POST', { message: '配置测试项目', asset: { title: '组合测试', directory: projectDir } });
  const variant = (name, body) => ({ frontmatter: { name, description: '检查文件。用户要求检查时使用。', metadata: { version: '1.0.0' } }, body });
  const skill = await request('skill', 'POST', { message: '保存 Claude 模型配置', asset: { title: '检查文件', assetHarness: 'claude', assetModelId: modelA.id, variants: { common: variant('inspect-file', 'Claude model A steps') }, files: {} } });
  const updatedSkill = await request('skill', 'POST', { message: '保存 Codex 模型配置', asset: { ...skill, assetHarness: 'codex', assetModelId: modelB.id, variants: { common: variant('inspect-file', 'Codex model B steps') }, files: {} } });
  assert.equal(Object.keys(updatedSkill.profiles).length, 2);
  const suite = await request('workflow', 'POST', { message: '保存 Claude 套件配置', asset: { title: '检查套件', assetHarness: 'claude', assetModelId: modelA.id, description: 'Claude 用途', members: [{ skillId: skill.id, role: 'Claude 角色' }] } });
  await request('workflow', 'POST', { message: '保存 Codex 套件配置', asset: { ...suite, assetHarness: 'codex', assetModelId: modelB.id, description: 'Codex 用途', members: [{ skillId: skill.id, role: 'Codex 角色' }] } });
  const prompt = await request('prompt', 'POST', { message: '保存 Claude 提示词', asset: { title: '通用指令', assetHarness: 'claude', assetModelId: modelA.id, scope: 'global', content: 'Claude model A instruction' } });
  await request('prompt', 'POST', { message: '保存 Codex 提示词', asset: { ...prompt, assetHarness: 'codex', assetModelId: modelB.id, scope: 'global', content: 'Codex model B instruction' } });
  const agent = await request('agent', 'POST', { message: '保存 Claude Agent', asset: { title: '检查 Agent', assetHarness: 'claude', assetModelId: modelA.id, harness: 'claude', modelId: modelA.id, instructions: 'Claude agent instructions', skillIds: [skill.id], workflowIds: [suite.id], promptIds: [prompt.id], tools: [], mcps: [] } });
  await request('agent', 'POST', { message: '保存 Codex Agent', asset: { ...agent, assetHarness: 'codex', assetModelId: modelB.id, harness: 'codex', modelId: modelB.id, instructions: 'Codex agent instructions', skillIds: [skill.id], workflowIds: [suite.id], promptIds: [prompt.id], tools: [], mcps: [] } });
  const claude = await request('deploy', 'POST', { projectId: project.id, software: 'claude', modelId: modelA.id, agentId: agent.id, promptIds: [prompt.id], preview: true });
  const codex = await request('deploy', 'POST', { projectId: project.id, software: 'codex', modelId: modelB.id, agentId: agent.id, promptIds: [prompt.id], preview: true });
  assert.match(claude.files.find(file => file.path.endsWith('SKILL.md')).content, /Claude model A steps/);
  assert.match(codex.files.find(file => file.path.endsWith('SKILL.md')).content, /Codex model B steps/);
  assert.match(claude.files.find(file => file.path.endsWith('CLAUDE.md')).content, /Claude agent instructions/);
  assert.match(codex.files.find(file => file.path.endsWith('AGENTS.md')).content, /Codex agent instructions/);
  assert.match(claude.files.find(file => file.path.endsWith('CLAUDE.md')).content, /Claude model A instruction/);
  assert.match(codex.files.find(file => file.path.endsWith('AGENTS.md')).content, /Codex model B instruction/);
  await assert.rejects(request('deploy', 'POST', { projectId: project.id, software: 'claude', modelId: modelB.id, agentId: agent.id, preview: true }), /尚无此 Harness/);
  assert.equal((await request(`skill/${skill.id}/history`)).length, 2);
});
