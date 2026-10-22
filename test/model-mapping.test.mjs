import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { normalizeApplicationMapping } from '../public/model-mapping.js';
import { codexModelCatalog } from '../model-catalog.mjs';
import { createModelApplication } from '../model-application.mjs';
import { normalizeModelService } from '../public/model-protocols.js';

const service = { id: 'supplier', title: 'DeepSeek', protocol: 'openai-responses', baseUrl: 'https://example.com/v1', claudeBaseUrl: 'https://example.com', model: 'deepseek-flash', aiModel: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'] };

test('模型资产能力优先于应用缓存，两个客户端投影并可撤销', t => {
  const { app, codexHome, claudeHome } = setup(t);
  const model = normalizeModelService({ ...service, modelCapabilities: [{ id: 'deepseek-flash', contextWindow: 1000000, reasoning: 'standard' }, { id: 'deepseek-v4-pro', contextWindow: 65536, reasoning: 'none' }] });
  const stale = { models: [{ id: 'deepseek-flash', contextWindow: 4096, reasoning: 'none' }, { id: 'deepseek-v4-pro', contextWindow: 4096, reasoning: 'standard' }] };
  for (const software of ['codex', 'claude']) {
    const input = { model, key: 'private-key', software, modelMapping: stale };
    const preview = app.preview(input);
    assert.equal(preview.modelMapping.models[0].contextWindow, 1000000);
    assert.equal(preview.modelMapping.models[0].reasoning, 'standard');
    assert.equal(fs.existsSync(path.join(software === 'codex' ? codexHome : claudeHome, software === 'codex' ? 'config.toml' : 'settings.json')), false);
    app.apply(input, preview.token);
    if (software === 'codex') {
      const config = parseToml(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'));
      assert.equal(config.model_reasoning_effort, 'medium');
      const catalog = JSON.parse(fs.readFileSync(config.model_catalog_json, 'utf8'));
      assert.equal(catalog.models[0].context_window, 1000000);
      assert.equal(catalog.models[1].supported_reasoning_levels.length, 0);
    } else {
      const config = JSON.parse(fs.readFileSync(path.join(claudeHome, 'settings.json')));
      assert.equal(config.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '65536');
      assert.equal(config.env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES, 'effort');
    }
    const restore = { software, restore: true }; app.apply(restore, app.preview(restore).token);
  }
  for (const row of [{ id: 'unknown' }, { id: service.model, contextWindow: 5 }, { id: service.model, reasoning: 'ultra' }]) assert.throws(() => normalizeModelService({ ...service, modelCapabilities: [row] }));
  assert.throws(() => normalizeModelService({ ...model, modelCapabilities: [...model.modelCapabilities, model.modelCapabilities[0]] }));
});
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

test('Codex 目录与主配置零写入预览、覆盖受管目录外部编辑、保留原目录设置及失败回滚', t => {
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
  assert.throws(() => app.apply(input, preview.token), /重新预览/);
  app.apply(input, app.preview(input).token);
  assert.equal(fs.readFileSync(catalogFile, 'utf8'), content);
  fs.writeFileSync(catalogFile, 'manually edited invalid JSON');
  const rebuild = app.preview(input); assert.match(rebuild.additionalFiles[0].before, /非 JSON/);
  app.apply(input, rebuild.token); assert.equal(fs.readFileSync(catalogFile, 'utf8'), content);
  fs.writeFileSync(catalogFile, content + ' ');
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

test('受管嵌套字段按新值覆盖，同一 provider 和 picker 内的非受管设置保留', t => {
  const { app, codexHome, claudeHome } = setup(t);
  const codexInput = { model: service, key: 'private-key', software: 'codex' };
  app.apply(codexInput, app.preview(codexInput).token);
  const file = path.join(codexHome, 'config.toml');
  fs.appendFileSync(file, '\n[model_providers.asset_manager.extra]\nkeep = "yes"\n');
  let config = parseToml(fs.readFileSync(file, 'utf8'));
  config.model = 'changed-by-client';
  config.model_providers.asset_manager.base_url = 'https://manually.changed';
  config.model_providers.asset_manager.request_max_retries = 9;
  fs.writeFileSync(file, stringifyToml(config));
  app.apply(codexInput, app.preview(codexInput).token);
  config = parseToml(fs.readFileSync(file, 'utf8'));
  assert.equal(config.model, service.model); assert.equal(config.model_providers.asset_manager.base_url, service.baseUrl);
  assert.equal(config.model_providers.asset_manager.request_max_retries, 9);
  assert.equal(config.model_providers.asset_manager.extra.keep, 'yes');
  const claudeInput = { model: service, key: 'private-key', software: 'claude' };
  app.apply(claudeInput, app.preview(claudeInput).token);
  const claudeFile = path.join(claudeHome, 'settings.json');
  let settings = JSON.parse(fs.readFileSync(claudeFile));
  settings.model = 'manual';
  settings.modelPicker.customOption = { keep: true };
  settings.env.OTHER = 'keep';
  fs.writeFileSync(claudeFile, JSON.stringify(settings));
  app.apply(claudeInput, app.preview(claudeInput).token);
  settings = JSON.parse(fs.readFileSync(claudeFile));
  assert.equal(settings.model, service.model); assert.deepEqual(settings.modelPicker.customOption, { keep: true }); assert.equal(settings.env.OTHER, 'keep');
});

test('旧版整表管理记录兼容为叶子字段，覆盖已改值但保留用户后来添加的同表字段', t => {
  const { app, privateDir, codexHome } = setup(t);
  const file = path.join(codexHome, 'config.toml');
  const beforeProvider = { name: 'Original', base_url: 'https://original.example', local_option: 'keep' };
  const writtenProvider = { name: 'Old managed', base_url: 'https://old.example', wire_api: 'responses', requires_openai_auth: false };
  const written = 'model="old"\n';
  const current = 'model="manual"\n[model_providers.asset_manager]\nname="manual"\nbase_url="https://manual.example"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=7\nlocal_option="edited"\n';
  fs.writeFileSync(file, current);
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  fs.writeFileSync(path.join(privateDir, 'model-applications.json'), JSON.stringify({ [digest(path.resolve(file))]: { software: 'codex', modelId: service.id, fields: [{ path: ['model'], before: { exists: true, value: 'original-model' }, written: { exists: true, value: 'old' } }, { path: ['model_providers', 'asset_manager'], before: { exists: true, value: beforeProvider }, written: { exists: true, value: writtenProvider } }], restoreContent: 'model="original-model"\n', writtenHash: digest(written) } }));
  const input = { model: service, key: 'private-key', software: 'codex' };
  const preview = app.preview(input); assert.match(preview.before, /manual.example/);
  app.apply(input, preview.token);
  let config = parseToml(fs.readFileSync(file, 'utf8'));
  assert.equal(config.model, service.model); assert.equal(config.model_providers.asset_manager.base_url, service.baseUrl);
  assert.equal(config.model_providers.asset_manager.request_max_retries, 7); assert.equal(config.model_providers.asset_manager.local_option, 'edited');
  const restore = { software: 'codex', restore: true }; app.apply(restore, app.preview(restore).token);
  config = parseToml(fs.readFileSync(file, 'utf8'));
  assert.equal(config.model, 'original-model'); assert.equal(config.model_providers.asset_manager.base_url, 'https://original.example');
  assert.equal(config.model_providers.asset_manager.request_max_retries, 7); assert.equal(config.model_providers.asset_manager.local_option, 'edited');
});
