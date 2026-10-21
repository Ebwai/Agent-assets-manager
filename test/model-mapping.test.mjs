import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse as parseToml } from 'smol-toml';
import { normalizeApplicationMapping } from '../public/model-mapping.js';
import { codexModelCatalog } from '../model-catalog.mjs';
import { createModelApplication } from '../model-application.mjs';

const service = { id: 'supplier', title: 'DeepSeek', protocol: 'openai-responses', baseUrl: 'https://example.com/v1', claudeBaseUrl: 'https://example.com', model: 'deepseek-flash', aiModel: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'] };
const mapping = { models: [{ id: 'deepseek-flash', label: '快速', contextWindow: 65536 }, { id: 'deepseek-v4-pro', label: '规划', contextWindow: 128000, reasoning: 'standard' }], claude: { opus: 'deepseek-v4-pro', subagent: 'deepseek-v4-pro' }, overrides: { 'claude-sonnet-4-6': 'deepseek-flash' } };

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mapping-test-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const privateDir = path.join(root, 'private'), codexHome = path.join(root, 'codex'), claudeHome = path.join(root, 'claude');
  for (const dir of [privateDir, codexHome, claudeHome]) fs.mkdirSync(dir);
  const keysFile = path.join(privateDir, 'keys.json'); fs.writeFileSync(keysFile, JSON.stringify({ supplier: 'private-key' }));
  return { root, privateDir, codexHome, claudeHome, app: createModelApplication({ privateDir, keysFile, codexHome, claudeHome }) };
}

test('映射校验：真实 ID、默认模型、重复和不支持的能力均被约束', () => {
  const normalized = normalizeApplicationMapping(service, 'deepseek-flash', mapping);
  assert.equal(normalized.claude.haiku, 'deepseek-flash'); assert.equal(normalized.claude.opus, 'deepseek-v4-pro');
  for (const invalid of [{ models: [] }, { models: [{ id: 'gpt-5.6-sol' }] }, { models: [{ id: 'deepseek-flash' }, { id: 'deepseek-flash' }] }, { models: [{ id: 'deepseek-v4-pro' }] }, { models: [{ id: 'deepseek-flash', contextWindow: 4 }] }, { models: [{ id: 'deepseek-flash', reasoning: 'ultra' }] }, { claude: { opus: 'unknown' } }, { overrides: { sonnet: 'deepseek-flash' } }]) assert.throws(() => normalizeApplicationMapping(service, 'deepseek-flash', invalid));
  assert.throws(() => normalizeApplicationMapping(service, 'deepseek-flash', { overrides: { 'claude-opus-4-6': 'unknown' } }));
  assert.equal(service.aiModel, 'deepseek-flash');
});

test('Claude 别名、指定版本和完整列表投影；重新应用恢复不再选择的旧映射，撤销保留原值', t => {
  const { app, claudeHome } = setup(t), file = path.join(claudeHome, 'settings.json');
  const original = { permissions: { allow: ['Read'] }, modelOverrides: { 'claude-sonnet-4-6': 'old', 'claude-opus-4-5': 'keep' }, env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'old-opus', OTHER: 'keep' } };
  fs.writeFileSync(file, JSON.stringify(original));
  const input = { model: service, key: 'private-key', software: 'claude', selectedModel: 'deepseek-flash', modelMapping: mapping };
  const preview = app.preview(input); assert.deepEqual(JSON.parse(fs.readFileSync(file)), original);
  assert.equal(preview.modelMapping.claude.opus, 'deepseek-v4-pro');
  assert.throws(() => app.apply({ ...input, modelMapping: { ...mapping, claude: { opus: 'deepseek-flash' } } }, preview.token), /重新预览/);
  app.apply(input, preview.token);
  let config = JSON.parse(fs.readFileSync(file));
  assert.equal(config.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'deepseek-v4-pro');
  assert.equal(config.env.CLAUDE_CODE_SUBAGENT_MODEL, 'deepseek-v4-pro');
  assert.equal(config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-flash');
  assert.equal(config.modelPicker.replaceBuiltInOptions, true); assert.deepEqual(config.modelPicker.options.map(row => row.model), service.models);
  assert.equal(config.modelOverrides['claude-sonnet-4-6'], 'deepseek-flash'); assert.equal(config.modelOverrides['claude-opus-4-5'], 'keep');
  assert.equal(app.state(service.id).claude.modelMapping.claude.opus, 'deepseek-v4-pro');
  const next = { ...input, modelMapping: { ...mapping, overrides: {} } }; app.apply(next, app.preview(next).token);
  config = JSON.parse(fs.readFileSync(file)); assert.equal(config.modelOverrides['claude-sonnet-4-6'], 'old');
  config.permissions.deny = ['Edit']; fs.writeFileSync(file, JSON.stringify(config));
  const restore = { software: 'claude', restore: true }; app.apply(restore, app.preview(restore).token);
  const restored = JSON.parse(fs.readFileSync(file)); assert.deepEqual(restored, { ...original, permissions: { allow: ['Read'], deny: ['Edit'] } });
});

test('Codex 目录与主配置零写入预览、保护外部编辑、保留原目录设置及失败回滚', t => {
  const { app, codexHome, privateDir } = setup(t), file = path.join(codexHome, 'config.toml');
  const original = 'model="old"\nmodel_catalog_json="C:/original.json"\nmodel_reasoning_effort="high"\n[model_providers.other]\nbase_url="https://other.example"\n';
  fs.writeFileSync(file, original);
  const input = { model: service, key: 'private-key', software: 'codex', selectedModel: 'deepseek-flash', modelMapping: mapping };
  let preview = app.preview(input), catalogFile = preview.additionalFiles[0].path;
  assert.equal(fs.existsSync(catalogFile), false); assert.equal(fs.readFileSync(file, 'utf8'), original);
  const rename = fs.renameSync; let failed = false;
  fs.renameSync = (source, target) => { if (!failed && target === file) { failed = true; throw new Error('模拟配置失败'); } return rename(source, target); };
  try { assert.throws(() => app.apply(input, preview.token), /模拟配置失败/); } finally { fs.renameSync = rename; }
  assert.equal(fs.existsSync(catalogFile), false); assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(privateDir, 'model-applications.json')), false);
  app.apply(input, app.preview(input).token);
  const config = parseToml(fs.readFileSync(file, 'utf8')); assert.equal(config.model, 'deepseek-flash'); assert.equal(config.review_model, 'deepseek-flash'); assert.equal(config.model_reasoning_effort, undefined);
  const catalog = JSON.parse(fs.readFileSync(catalogFile)); assert.deepEqual(catalog.models.map(row => row.slug), service.models); assert.equal(catalog.models[0].use_responses_lite, false);
  const content = fs.readFileSync(catalogFile, 'utf8'); preview = app.preview(input); fs.writeFileSync(catalogFile, content + ' ');
  assert.throws(() => app.apply(input, preview.token), /目录.*外部修改/);
  assert.throws(() => app.preview({ software: 'codex', restore: true }), /目录.*外部修改/);
  fs.writeFileSync(catalogFile, content);
  const restore = { software: 'codex', restore: true }; app.apply(restore, app.preview(restore).token);
  assert.equal(fs.readFileSync(file, 'utf8'), original); assert.equal(fs.existsSync(catalogFile), false);
});

test('已安装 Codex 实际读取生成目录，模型 ID 与能力通过客户端解析', t => {
  const command = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const available = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (available.status !== 0) { t.skip('未安装 Codex，目录原生解析由本机验收执行'); return; }
  const { root } = setup(t), file = path.join(root, 'models.json');
  fs.writeFileSync(file, codexModelCatalog(normalizeApplicationMapping(service, 'deepseek-flash', mapping)));
  const result = spawnSync(command, ['-c', 'model_catalog_json=' + JSON.stringify(file), 'debug', 'models'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout); assert.deepEqual(parsed.models.map(row => row.slug), service.models);
  assert.equal(parsed.models[0].context_window, 65536); assert.equal(parsed.models[0].supported_reasoning_levels.length, 0); assert.equal(parsed.models[1].supported_reasoning_levels.length, 3);
});
