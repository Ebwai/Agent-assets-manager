import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { appendIssueText, issueIncluded } from '../public/issue-helpers.js';

test('问题文字追加保留已有说明与换行', () => {
  assert.equal(appendIssueText('已有说明', '修复问题\n继续说明'), '已有说明\n\n修复问题\n继续说明');
  assert.equal(appendIssueText('', '问题记录'), '问题记录');
  assert.equal(appendIssueText('原文\n', '问题记录'), '原文\n问题记录');
});

test('各类资产的问题独立保存，完成后按提交关联，历史切换与失败保留记录', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-issues-test-'));
  const data = path.join(temp, 'data');
  const port = 40000 + Math.floor(Math.random() * 15000);
  const server = spawn(process.execPath, ['server.mjs'], { cwd: path.resolve('.'), env: { ...process.env, ASSET_DATA_DIR: data, PORT: String(port) }, stdio: 'pipe' });
  t.after(async () => {
    server.kill();
    if (server.exitCode === null) await once(server, 'exit');
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const request = async (url, method = 'GET', body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/${url}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    return result;
  };
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await request('bootstrap'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(ready, 'server started');
  const drafts = {
    skill: { title: '问题测试 Skill', variants: { common: { frontmatter: { name: 'issue-test', description: '测试资产的问题记录' }, body: '正文' } }, files: {} },
    workflow: { title: '问题测试套件', description: '测试套件', members: [] },
    prompt: { title: '问题测试提示词', scope: 'global', content: '原始内容' },
    agent: { title: '问题测试 Agent', skillIds: [], workflowIds: [], tools: [], mcps: [] },
    hook: { title: '问题测试 Hook', harness: 'claude', event: 'PreToolUse', matcher: 'Bash', async: false, timeout: 5, runtime: 'node', entry: 'scripts/main.mjs', files: { 'scripts/main.mjs': 'process.exit(0);' } },
    hookgroup: { title: '问题测试组', description: '测试用途', harness: 'claude', members: [] },
    rule: { title: '问题测试 Rule', harness: 'claude', paths: [], fileName: 'issue-test.md', content: '规范' },
    project: { title: '问题测试项目' },
    model: { title: '问题测试模型', model: 'test', baseUrl: 'https://example.com' },
    settings: { title: '问题测试审查', reviewSystem: '审查', improveSystem: '改进' },
  };
  let asset;
  const assets = {};
  for (const [type, draft] of Object.entries(drafts)) {
    if (type === 'workflow') draft.members = [{ skillId: assets.skill.id, role: '测试问题记录' }];
    if (type === 'hookgroup') draft.members = [{ hookId: assets.hook.id }];
    const saved = await request(type, 'POST', { asset: draft, message: '创建测试版本' });
    assets[type] = saved;
    const records = await request(`${type}/${saved.id}/issues`, 'POST', { text: '快速记下问题和想法' });
    assert.equal(records.length, 1);
    assert.equal((await request(`${type}/${saved.id}`)).issues[0].text, '快速记下问题和想法');
    assert.equal((await request(`${type}/${saved.id}/history`)).length, 1);
    if (type === 'prompt') asset = saved;
  }
  const endpoint = `prompt/${asset.id}/issues`;
  let records = await request(endpoint);
  const original = (await request(`prompt/${asset.id}/history`))[0];
  assert.equal(records[0].sourceVersion, original.hash);
  const headBeforeNotes = execFileSync('git', ['-C', path.join(data, 'repo'), 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  await assert.rejects(request(endpoint, 'POST', { text: '   ' }), /填写问题/);
  await assert.rejects(request(endpoint, 'POST', { text: 'x'.repeat(10001) }), /10000/);
  const firstId = records[0].id;
  const staleStamp = records[0].updatedAt;
  records = await request(`${endpoint}/${firstId}`, 'PUT', { expectedUpdatedAt: staleStamp, text: '修复边界情况\n考虑保留已有内容 <script>alert(1)</script>' });
  await assert.rejects(request(`${endpoint}/${firstId}`, 'PUT', { expectedUpdatedAt: staleStamp, completed: true }), /已变化/);
  records = await request(`${endpoint}/${firstId}`, 'PUT', { expectedUpdatedAt: records[0].updatedAt, completed: true });
  assert.ok(records[0].completedAt);
  assert.equal(issueIncluded(records[0]), false);
  records = await request(endpoint, 'POST', { text: '这条下次再提交' });
  const secondId = records[1].id;
  records = await request(`${endpoint}/${secondId}`, 'PUT', { expectedUpdatedAt: records[1].updatedAt, completed: true });
  assert.equal(execFileSync('git', ['-C', path.join(data, 'repo'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }), headBeforeNotes, 'record edits create no Git commits');
  const selection = issue => ({ id: issue.id, updatedAt: issue.updatedAt });
  await assert.rejects(request('prompt', 'POST', { asset, message: '不应成功', completedIssues: [{ id: secondId, updatedAt: staleStamp }] }), /已变化/);
  assert.equal((await request(`prompt/${asset.id}/history`)).length, 1);
  const longMessage = '修改说明\n' + records[0].text + '\n' + '补充文字'.repeat(80);
  asset = await request('prompt', 'POST', { asset: { ...asset, content: '修改后的内容', issues: [] }, message: longMessage, completedIssues: [selection(records[0])] });
  records = await request(endpoint);
  const submittedVersion = (await request(`prompt/${asset.id}/history`))[0];
  assert.equal(records[0].versions[0].hash, submittedVersion.hash);
  assert.ok(submittedVersion.message.includes(longMessage), 'history shows the full multiline version explanation');
  assert.equal(records[0].versions[0].text, records[0].text);
  assert.equal(issueIncluded(records[0]), true);
  assert.equal(issueIncluded(records[1]), false, 'omitted completed records remain candidates after submission');
  assert.equal(asset.issues.length, 2, 'stale asset issue payload cannot erase sidecar records');
  assert.equal(fs.readFileSync(path.join(data, 'repo', 'assets', 'prompt', asset.id + '.json'), 'utf8').includes('"issues"'), false);
  await request(`prompt/${asset.id}/select-version`, 'POST', { hash: original.hash });
  const historical = await request(`prompt/${asset.id}`);
  assert.equal(historical.content, '原始内容');
  assert.equal(historical.issues.length, 2);
  assert.equal(issueIncluded(historical.issues[0]), true);
  records = await request(endpoint, 'POST', { text: '在旧版本发现的问题' });
  assert.equal(records[2].sourceVersion, original.hash);
  records = await request(`${endpoint}/${firstId}`, 'PUT', { expectedUpdatedAt: records[0].updatedAt, completed: false });
  assert.equal(records[0].versions.length, 1, 'reopening retains prior submission');
  records = await request(`${endpoint}/${firstId}`, 'PUT', { expectedUpdatedAt: records[0].updatedAt, completed: true });
  assert.equal(issueIncluded(records[0]), false, 'new completion can be recorded in another version');
  const hookPath = path.join(data, 'repo', '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hookPath, '#!/bin/sh\nexit 1\n');
  await assert.rejects(request('prompt', 'POST', { asset: { ...asset, content: '失败时的草稿' }, message: '模拟提交失败', completedIssues: [selection(records[0])] }));
  assert.equal(issueIncluded((await request(endpoint))[0]), false);
  fs.unlinkSync(hookPath);
  asset = await request('prompt', 'POST', { asset: { ...asset, content: '再次成功修改' }, message: '再次解决问题', completedIssues: [selection(records[0]), selection(records[1])] });
  records = await request(endpoint);
  assert.equal(records[0].versions.length, 2);
  assert.equal(issueIncluded(records[0]), true);
  assert.equal(issueIncluded(records[1]), true);
  await assert.rejects(request('prompt', 'POST', { asset, message: '禁止重复关联', completedIssues: [selection(records[0])] }), /已变化/);
  records = await request(`${endpoint}/${records[2].id}`, 'DELETE', { expectedUpdatedAt: records[2].updatedAt });
  assert.equal(records.length, 2);
  assert.ok(await request(`prompt/${asset.id}`), 'deleting a note never deletes the asset');
  await request(`prompt/${asset.id}`, 'DELETE', { message: '临时删除资产' });
  await request(`prompt/${asset.id}/restore`, 'POST', { hash: original.hash, message: '恢复资产' });
  assert.equal((await request(endpoint)).length, 2, 'restoring asset retains notes');
});
