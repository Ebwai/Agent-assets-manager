import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseToml } from 'smol-toml';
import crypto from 'node:crypto';
import { createModelApplication, targetModel } from '../model-application.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-application-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const privateDir = path.join(root, 'private'), codexHome = path.join(root, 'codex'), claudeHome = path.join(root, 'claude'), projectDirectory = path.join(root, 'project');
  fs.mkdirSync(privateDir); fs.mkdirSync(projectDirectory); fs.mkdirSync(codexHome);
  const keysFile = path.join(privateDir, 'keys.json');
  fs.writeFileSync(keysFile, JSON.stringify({ 'model-a': 'private-key' }));
  const app = createModelApplication({ privateDir, keysFile, codexHome, claudeHome });
  const model = { id: 'model-a', title: '测试服务', model: 'test-model', baseUrl: 'https://example.com', protocol: 'anthropic' };
  return { root, privateDir, codexHome, claudeHome, projectDirectory, keysFile, app, model };
}

test('协议兼容门禁与网关覆盖，不能把 Chat Completions 当成 Responses', () => {
  const model = { title: 'test', model: 'test', baseUrl: 'https://example.com', protocol: 'openai-chat' };
  assert.throws(() => targetModel(model, 'codex'), /Responses/);
  assert.throws(() => targetModel(model, 'claude'), /Messages/);
  const target = targetModel({ ...model, codexBaseUrl: 'https://gateway.example/v1', codexModel: 'mapped-model' }, 'codex');
  assert.equal(target.protocol, 'openai-responses'); assert.equal(target.model, 'mapped-model');
});

test('Claude 用户级配置：预览不写入、隐藏原有密钥、辅助程序运行时读取新密钥、完整撤销', t => {
  const { app, model, privateDir, projectDirectory, claudeHome, keysFile } = setup(t);
  const file = path.join(claudeHome, 'settings.json');
  const original = '{\n  "env": {"ANTHROPIC_API_KEY":"old-secret", "OTHER":"keep"},\n  "permissions":{"allow":["Read"]}\n}\n';
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, original);
  const input = { model, key: 'private-key', software: 'claude', projectDirectory };
  const preview = app.preview(input);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(privateDir, 'model-auth.mjs')), false);
  assert.equal(fs.existsSync(path.join(privateDir, 'model-applications.json')), false);
  assert.ok(!JSON.stringify(preview).includes('old-secret')); assert.ok(!JSON.stringify(preview).includes('private-key'));
  app.apply(input, preview.token);
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(settings.env.ANTHROPIC_BASE_URL, 'https://example.com');
  assert.equal(settings.env.ANTHROPIC_MODEL, 'test-model');
  assert.equal(settings.env.OTHER, 'keep'); assert.equal(settings.env.ANTHROPIC_API_KEY, undefined);
  assert.ok(settings.apiKeyHelper.includes('model-auth.mjs'));
  const shellAuth = spawnSync(settings.apiKeyHelper, { shell: true, encoding: 'utf8' });
  assert.equal(shellAuth.status, 0, shellAuth.stderr);
  assert.equal(shellAuth.stdout, 'private-key');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('private-key'));
  const helper = path.join(privateDir, 'model-auth.mjs');
  assert.equal(spawnSync(process.execPath, [helper, model.id], { encoding: 'utf8' }).stdout, 'private-key');
  fs.writeFileSync(keysFile, JSON.stringify({ [model.id]: 'rotated-key' }));
  assert.equal(spawnSync(process.execPath, [helper, model.id], { encoding: 'utf8' }).stdout, 'rotated-key');
  const second = app.preview(input); app.apply(input, second.token);
  const restore = { software: 'claude', projectDirectory, restore: true };
  app.apply(restore, app.preview(restore).token);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('Codex 用户级 provider：保留其他配置，密钥用命令提供，不写项目 provider，切换与恢复保持原值', t => {
  const { app, model, privateDir, codexHome, projectDirectory } = setup(t);
  const file = path.join(codexHome, 'config.toml');
  const original = '# original comment\nmodel = "original"\nmodel_provider = "existing"\n[model_providers.existing]\nbase_url = "https://existing.example/v1"\n[mcp_servers.demo]\ncommand = "demo"\n';
  fs.writeFileSync(file, original);
  const input = { software: 'codex', key: 'private-key', model: { ...model, protocol: 'openai-responses', baseUrl: 'https://gateway.example/v1/responses' } };
  const preview = app.preview(input); assert.equal(preview.path, file); assert.match(preview.scope, /当前用户/);
  app.apply(input, preview.token);
  let config = parseToml(fs.readFileSync(file, 'utf8'));
  assert.equal(config.model_provider, 'asset_manager'); assert.equal(config.model, 'test-model');
  assert.equal(config.model_providers.asset_manager.base_url, 'https://gateway.example/v1');
  assert.equal(config.model_providers.asset_manager.wire_api, 'responses');
  assert.equal(config.model_providers.existing.base_url, 'https://existing.example/v1');
  assert.equal(config.mcp_servers.demo.command, 'demo');
  assert.equal(fs.existsSync(path.join(projectDirectory, '.codex', 'config.toml')), false);
  const auth = config.model_providers.asset_manager.auth;
  assert.equal(spawnSync(auth.command, auth.args, { encoding: 'utf8' }).stdout, 'private-key');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('private-key'));
  assert.ok(fs.existsSync(path.join(privateDir, 'model-applications.json')));
  const switched = { ...input, model: { ...input.model, model: 'another-model', authMode: 'none' } };
  app.apply(switched, app.preview(switched).token);
  config = parseToml(fs.readFileSync(file, 'utf8')); assert.equal(config.model, 'another-model'); assert.equal(config.model_providers.asset_manager.auth, undefined);
  const restore = { software: 'codex', restore: true };
  app.apply(restore, app.preview(restore).token);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('文件、模型、密钥变化使预览过期，外部修改受管字段时停止应用和撤销', t => {
  const { app, model, projectDirectory, claudeHome } = setup(t);
  const input = { model, key: 'private-key', software: 'claude', projectDirectory };
  const preview = app.preview(input);
  assert.throws(() => app.apply({ ...input, key: 'new-key' }, preview.token), /重新预览/);
  assert.throws(() => app.apply({ ...input, model: { ...model, model: 'changed' } }, preview.token), /重新预览/);
  fs.mkdirSync(path.dirname(preview.path)); fs.writeFileSync(preview.path, '{}');
  assert.throws(() => app.apply(input, preview.token), /重新预览/);
  app.apply(input, app.preview(input).token);
  const external = JSON.parse(fs.readFileSync(preview.path, 'utf8')); external.env.ANTHROPIC_BASE_URL = 'https://manual.example';
  fs.writeFileSync(preview.path, JSON.stringify(external));
  assert.throws(() => app.preview(input), /外部修改/);
  assert.throws(() => app.preview({ software: 'claude', projectDirectory, restore: true }), /外部修改/);
  assert.equal(JSON.parse(fs.readFileSync(preview.path, 'utf8')).env.ANTHROPIC_BASE_URL, 'https://manual.example');
});

test('撤销保留无关手动修改，初次创建的文件可完全恢复为不存在', t => {
  const { app, model, projectDirectory, claudeHome } = setup(t);
  const input = { model, key: 'private-key', software: 'claude', projectDirectory };
  let preview = app.preview(input); app.apply(input, preview.token);
  const restore = { software: 'claude', projectDirectory, restore: true };
  app.apply(restore, app.preview(restore).token); assert.equal(fs.existsSync(preview.path), false);
  preview = app.preview(input); app.apply(input, preview.token);
  const settings = JSON.parse(fs.readFileSync(preview.path, 'utf8')); settings.permissions = { allow: ['Read'] };
  fs.writeFileSync(preview.path, JSON.stringify(settings));
  // Reapplying after an unrelated edit must not lose it when later restoring.
  app.apply(input, app.preview(input).token);
  app.apply(restore, app.preview(restore).token);
  assert.deepEqual(JSON.parse(fs.readFileSync(preview.path, 'utf8')), { permissions: { allow: ['Read'] } });
});


test('写入管理记录失败时回滚配置与辅助程序', t => {
  const { app, model, privateDir, projectDirectory } = setup(t);
  const input = { model, key: 'private-key', software: 'claude', projectDirectory };
  const preview = app.preview(input);
  const originalRename = fs.renameSync;
  let failed = false;
  fs.renameSync = (source, target) => {
    if (!failed && target === path.join(privateDir, 'model-applications.json')) { failed = true; throw new Error('模拟磁盘写入失败'); }
    return originalRename(source, target);
  };
  try { assert.throws(() => app.apply(input, preview.token), /模拟磁盘/); }
  finally { fs.renameSync = originalRename; }
  assert.equal(fs.existsSync(preview.path), false);
  assert.equal(fs.existsSync(path.join(privateDir, 'model-auth.mjs')), false);
  assert.equal(fs.existsSync(path.join(privateDir, 'model-applications.json')), false);
});


test('配置中的带转义字符密钥按结构脱敏，辅助命令可供预览', t => {
  const { app, model, projectDirectory, claudeHome } = setup(t);
  const file = path.join(claudeHome, 'settings.json');
  fs.mkdirSync(path.dirname(file));
  const secret = 'old-"quoted"-\\\\key';
  fs.writeFileSync(file, JSON.stringify({env:{ANTHROPIC_API_KEY:secret}}));
  const preview = app.preview({model,key:'private-key',software:'claude',projectDirectory});
  assert.equal(JSON.parse(preview.before).env.ANTHROPIC_API_KEY, '[密钥已隐藏]');
  assert.match(JSON.parse(preview.after).apiKeyHelper, /model-auth\.mjs/);
});


test('外部模型选择与 AI 辅助模型独立，模型不在列表或预览后选择变化时拒绝', t => {
  const { app, model, claudeHome, projectDirectory } = setup(t);
  const service = { ...model, models: ['ai-model', 'client-model'], aiModel: 'ai-model', model: 'ai-model' };
  const input = { model: service, key: 'private-key', software: 'claude', selectedModel: 'client-model' };
  const preview = app.preview(input);
  assert.equal(preview.path, path.join(claudeHome, 'settings.json')); assert.match(preview.scope, /当前用户/);
  assert.throws(() => app.apply({ ...input, selectedModel: 'ai-model' }, preview.token), /重新预览/);
  app.apply(input, preview.token);
  assert.equal(JSON.parse(fs.readFileSync(preview.path, 'utf8')).model, 'client-model');
  assert.equal(service.aiModel, 'ai-model'); assert.equal(fs.existsSync(path.join(projectDirectory, '.claude')), false);
  assert.throws(() => app.preview({ ...input, selectedModel: 'missing' }), /模型列表/);
});

function seedLegacy(context) {
  const file = path.join(context.projectDirectory, '.claude', 'settings.local.json');
  const original = JSON.stringify({ permissions: { allow: ['Read'] } }, null, 2) + '\n';
  const written = JSON.stringify({ permissions: { allow: ['Read'] }, model: 'test-model' }, null, 2) + '\n';
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, written);
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  fs.writeFileSync(path.join(context.privateDir, 'model-applications.json'), JSON.stringify({ [digest(path.resolve(file))]: { software: 'claude', fields: [{ path: ['model'], before: { exists: false }, written: { exists: true, value: 'test-model' } }], restoreContent: original, writtenHash: digest(written) } }));
  return { file, original, written };
}

test('旧项目覆盖随用户级应用预览恢复，预览零写入并保留原项目设置', t => {
  const context = setup(t), legacy = seedLegacy(context);
  const input = { model: context.model, key: 'private-key', software: 'claude', legacyProjectDirectories: [context.projectDirectory] };
  const preview = context.app.preview(input);
  assert.equal(preview.legacyRestorations.length, 1); assert.equal(preview.legacyRestorations[0].path, legacy.file);
  assert.equal(fs.readFileSync(legacy.file, 'utf8'), legacy.written); assert.equal(fs.existsSync(preview.path), false);
  context.app.apply(input, preview.token);
  assert.equal(fs.readFileSync(legacy.file, 'utf8'), legacy.original);
  assert.equal(JSON.parse(fs.readFileSync(preview.path, 'utf8')).model, 'test-model');
});

test('旧项目受管字段被修改则拒绝迁移，无关修改使旧预览失效', t => {
  const context = setup(t), legacy = seedLegacy(context);
  const input = { model: context.model, key: 'private-key', software: 'claude', legacyProjectDirectories: [context.projectDirectory] };
  const preview = context.app.preview(input);
  fs.writeFileSync(legacy.file, JSON.stringify({ model: 'test-model', other: true }));
  assert.throws(() => context.app.apply(input, preview.token), /重新预览/);
  fs.writeFileSync(legacy.file, JSON.stringify({ model: 'manual-change' }));
  assert.throws(() => context.app.preview(input), /外部修改/);
  assert.equal(fs.existsSync(preview.path), false);
});
