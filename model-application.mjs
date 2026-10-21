import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { apiUrl, modelApiRoot, validateModel } from './model-protocols.mjs';
import { modelProtocol, aiModelId, serviceModelIds } from './public/model-protocols.js';
import { normalizeApplicationMapping, claudeModelSlots } from './public/model-mapping.js';
import { codexModelCatalog } from './model-catalog.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function field(document, parts) {
  let parent = document;
  for (const part of parts.slice(0, -1)) {
    parent = parent?.[part];
    if (!object(parent)) return { exists: false };
  }
  const key = parts.at(-1);
  return parent && Object.hasOwn(parent, key) ? { exists: true, value: parent[key] } : { exists: false };
}

function setField(document, parts, entry) {
  let parent = document;
  const ancestors = [];
  for (const part of parts.slice(0, -1)) {
    if (parent[part] !== undefined && !object(parent[part])) throw new Error('现有配置包含不兼容的数据结构，已停止写入');
    if (!parent[part]) parent[part] = {};
    ancestors.push([parent, part]);
    parent = parent[part];
  }
  if (entry.exists) parent[parts.at(-1)] = structuredClone(entry.value);
  else {
    delete parent[parts.at(-1)];
    for (const [ancestor, key] of ancestors.reverse()) if (!Object.keys(ancestor[key]).length) delete ancestor[key];
  }
}

function assertOrdinaryPath(file) {
  let current = path.resolve(file);
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('目标配置路径包含符号链接，已停止写入');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function shellQuote(value) {
  if (process.platform !== 'win32') return `'${value.replaceAll("'", "'\\''")}'`;
  if (/["%\r\n]/.test(value)) throw new Error('本机程序路径包含不支持的命令字符，无法生成凭据辅助命令');
  return `"${value}"`;
}

// Object containers are not ownership boundaries: only generated leaves belong to us.
// This also narrows older records that treated an entire provider/picker as owned.
function managedLeaves(owned) {
  if (!owned.written.exists || !object(owned.written.value) || !Object.keys(owned.written.value).length) return [owned];
  return Object.entries(owned.written.value).flatMap(([key, value]) => managedLeaves({
    path: [...owned.path, key],
    before: owned.before.exists && object(owned.before.value) ? field(owned.before.value, [key]) : { exists: false },
    written: { exists: true, value }
  }));
}

export function targetModel(model, software, selectedModel) {
  validateModel(model);
  if (!['claude', 'codex'].includes(software)) throw new Error('请选择 Claude Code 或 Codex');
  const protocol = software === 'claude' ? 'anthropic' : 'openai-responses';
  const override = model[software === 'claude' ? 'claudeBaseUrl' : 'codexBaseUrl'];
  if (modelProtocol(model) !== protocol && !override) throw new Error(`${software === 'claude' ? 'Claude Code 需要 Anthropic Messages' : 'Codex 需要 OpenAI Responses'} 兼容端点；请在模型配置中填写对应网关地址，或选择兼容协议的模型服务`);
  const baseUrl = override || model.baseUrl;
  apiUrl(baseUrl);
  const chosen = selectedModel === undefined ? model[software === 'claude' ? 'claudeModel' : 'codexModel']?.trim() || aiModelId(model) : selectedModel;
  if (!serviceModelIds(model).includes(chosen)) throw new Error('请从此供应商已保存的模型列表中选择目标模型');
  return { ...model, protocol, baseUrl, model: chosen };
}

export function createModelApplication({ privateDir, keysFile, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') }) {
  const recordFile = path.join(privateDir, 'model-applications.json');
  const helperFile = path.join(privateDir, 'model-auth.mjs');
  const helperContent = `import fs from 'node:fs';\ntry {\n  const key = JSON.parse(fs.readFileSync(${JSON.stringify(keysFile)}, 'utf8'))[process.argv[2]];\n  if (typeof key !== 'string' || !key || /[\\r\\n]/.test(key)) throw Error();\n  process.stdout.write(key);\n} catch { process.stderr.write('模型密钥不存在，请在资产管理助手中重新配置。\\n'); process.exitCode = 1; }\n`;

  function plan({ model, key, software, selectedModel, modelMapping, legacyProjectDirectories = [], restore = false }) {
    if (!['claude', 'codex'].includes(software)) throw new Error('目标软件无效');
    const file = software === 'claude' ? path.join(claudeHome, 'settings.json') : path.join(codexHome, 'config.toml');
    assertOrdinaryPath(file);
    assertOrdinaryPath(recordFile);
    assertOrdinaryPath(helperFile);
    const before = read(file);
    let document;
    try { document = before === null ? {} : software === 'claude' ? JSON.parse(before) : parseToml(before); } catch { throw new Error('现有目标配置无法解析，已停止写入'); }
    if (!object(document)) throw new Error('现有目标配置必须是对象');
    const recordsText = read(recordFile);
    const records = recordsText ? JSON.parse(recordsText) : {};
    const recordId = hash(path.resolve(file));
    const previous = records[recordId];
    if (previous) previous.fields = previous.fields.flatMap(managedLeaves);
    const serialize = value => software === 'claude' ? JSON.stringify(value, null, 2) + '\n' : stringifyToml(value);
    const legacyFiles = [];
    if (software === 'claude' && !restore) {
      for (const directory of [...new Set(legacyProjectDirectories)]) {
        if (typeof directory !== 'string' || !path.isAbsolute(directory)) continue;
        const legacyFile = path.join(directory, '.claude', 'settings.local.json');
        const legacyId = hash(path.resolve(legacyFile));
        const legacy = records[legacyId];
        if (!legacy || legacy.software !== 'claude') continue;
        assertOrdinaryPath(legacyFile);
        const legacyBefore = read(legacyFile);
        let legacyDocument;
        try { legacyDocument = legacyBefore === null ? {} : JSON.parse(legacyBefore); } catch { throw new Error('旧项目 API 配置无法解析，已停止迁移'); }
        legacy.fields = legacy.fields.flatMap(managedLeaves);
        for (const owned of legacy.fields) setField(legacyDocument, owned.path, owned.before);
        const legacyContent = legacyBefore !== null && hash(legacyBefore) === legacy.writtenHash ? legacy.restoreContent : JSON.stringify(legacyDocument, null, 2) + '\n';
        legacyFiles.push({ file: legacyFile, before: legacyBefore, content: legacyContent });
        delete records[legacyId];
      }
    }
    const additionalFiles = [];
    const catalogFile = path.join(privateDir, 'model-catalogs', recordId + '.json');
    const oldCatalog = previous?.catalog;
    if (oldCatalog) {
      assertOrdinaryPath(catalogFile);
      if (oldCatalog.file !== catalogFile) throw new Error('模型目录恢复路径与目标配置不一致');
    }
    let content, nextRecord, mapping;
    const warnings = ['确认后将覆盖助手管理的 API 字段，即使它们已被手动或客户端修改；其他配置保留。撤销会恢复这些字段首次应用前的值。'];
    if (restore) {
      if (!previous) throw new Error('此位置没有可撤销的助手 API 配置');
      for (const owned of previous.fields) setField(document, owned.path, owned.before);
      content = before !== null && hash(before) === previous.writtenHash ? previous.restoreContent : serialize(document);
      delete records[recordId];
      if (oldCatalog) additionalFiles.push({ file: catalogFile, before: read(catalogFile), content: oldCatalog.restoreContent });
    } else {
      if (!model?.id) throw new Error('请先保存模型服务');
      const target = targetModel(model, software, selectedModel);
      mapping = normalizeApplicationMapping(model, target.model, modelMapping);
      if (model.authMode !== 'none' && !key) throw new Error('请先保存 API Key');
      const rootUrl = modelApiRoot(target, target.protocol);
      const updates = software === 'claude' ? [
        { path: ['env', 'ANTHROPIC_BASE_URL'], entry: { exists: true, value: rootUrl } },
        { path: ['env', 'ANTHROPIC_MODEL'], entry: { exists: true, value: target.model } },
        { path: ['model'], entry: { exists: true, value: target.model } },
        { path: ['env', 'ANTHROPIC_API_KEY'], entry: { exists: false } },
        { path: ['env', 'ANTHROPIC_AUTH_TOKEN'], entry: { exists: false } },
        { path: ['apiKeyHelper'], entry: model.authMode === 'none' ? { exists: false } : { exists: true, value: [process.execPath, helperFile, model.id].map(shellQuote).join(' ') } }
      ] : [
        { path: ['model'], entry: { exists: true, value: target.model } },
        { path: ['model_provider'], entry: { exists: true, value: 'asset_manager' } },
        { path: ['model_providers', 'asset_manager'], entry: { exists: true, value: { name: model.title, base_url: rootUrl, wire_api: 'responses', requires_openai_auth: false, supports_websockets: false, ...(model.authMode === 'none' ? {} : { auth: { command: process.execPath, args: [helperFile, model.id] } }) } } }
      ];
      if (software === 'claude') {
        for (const [slot, , variable] of claudeModelSlots) updates.push({ path: ['env', variable], entry: { exists: true, value: mapping.claude[slot] } });
        updates.push(
          { path: ['env', 'ANTHROPIC_SMALL_FAST_MODEL'], entry: { exists: true, value: mapping.claude.haiku } },
          { path: ['env', 'ANTHROPIC_CUSTOM_MODEL_OPTION'], entry: { exists: true, value: target.model } },
          { path: ['env', 'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME'], entry: { exists: true, value: target.model } },
          { path: ['modelPicker'], entry: { exists: true, value: { replaceBuiltInOptions: true, options: mapping.models.map(row => ({ model: row.id, label: row.label === row.id ? row.id : row.label + ' (' + row.id + ')' })) } } }
        );
        for (const [source, id] of Object.entries(mapping.overrides)) updates.push({ path: ['modelOverrides', source], entry: { exists: true, value: id } });
        warnings.push('Claude Code 完整自定义模型列表需要 2.1.242 或以上；旧版本使用家族别名映射和单个自定义选项。明确指定其他版本的 Agent 定义仍可能覆盖子任务默认模型。');
        if (document.availableModels) warnings.push('现有 availableModels 限制已保留，可能限制列表中的模型；组织策略同样优先。');
      } else {
        if (!mapping.models.some(row => row.id === mapping.reviewModel)) throw new Error('代码审查模型必须包含在目标软件列表中');
        assertOrdinaryPath(catalogFile);
        const catalogBefore = read(catalogFile), catalogContent = codexModelCatalog(mapping);
        additionalFiles.push({ file: catalogFile, before: catalogBefore, content: catalogContent });
        updates.push(
          { path: ['model_providers', 'asset_manager', 'env_key'], entry: { exists: false } },
          { path: ['model_providers', 'asset_manager', 'experimental_bearer_token'], entry: { exists: false } },
          ...(model.authMode === 'none' ? [{ path: ['model_providers', 'asset_manager', 'auth'], entry: { exists: false } }] : []),
          { path: ['model_catalog_json'], entry: { exists: true, value: catalogFile } },
          { path: ['review_model'], entry: { exists: true, value: mapping.reviewModel } },
          { path: ['model_reasoning_effort'], entry: mapping.models.find(row => row.id === target.model).reasoning === 'none' ? { exists: false } : { exists: true, value: 'medium' } }
        );
        warnings.push('模型目录在客户端启动时加载。请完全退出并重新打开 Codex／桌面端，新建本地聊天并选择供应商模型；旧聊天保存的 GPT 模型不会自动改写。此配置不改变 ChatGPT 云端聊天的模型列表。');
        if (document.profile) warnings.push('当前启用了配置 profile，它的模型或目录设置可能覆盖本次用户级默认值，请核对实际生效配置。');
      }
      // Recover the baseline before applying again, retaining unrelated user changes.
      if (previous) for (const owned of previous.fields) setField(document, owned.path, owned.before);
      const baseline = !previous ? before : before !== null && hash(before) === previous.writtenHash ? previous.restoreContent : serialize(document);
      const fields = updates.flatMap(update => managedLeaves({ path: update.path, before: field(document, update.path), written: update.entry }));
      for (const owned of fields) setField(document, owned.path, owned.written);
      content = serialize(document);
      nextRecord = { modelId: model.id, selectedModel: target.model, path: file, software, fields, restoreContent: baseline, writtenHash: hash(content) };
      nextRecord.modelMapping = mapping;
      if (software === 'codex') nextRecord.catalog = { file: catalogFile, restoreContent: oldCatalog ? oldCatalog.restoreContent : read(catalogFile), writtenHash: hash(additionalFiles[0].content) };
      records[recordId] = nextRecord;
    }
    const token = hash(JSON.stringify({ file, before, content, recordsText, model, selectedModel, modelMapping, legacyFiles, additionalFiles, keyHash: hash(key || ''), restore, helper: read(helperFile) }));
    return { file, before, content, token, records, restore, helperContent, recordsText, software, legacyFiles, additionalFiles, mapping, warnings, scope: `本机当前用户的 ${software === 'claude' ? 'Claude Code' : 'Codex'} 配置（影响使用此配置的新会话）` };
  }

  function preview(input) {
    const result = plan(input);
    const secrets = new Set(input.key ? [input.key] : []);
    const isSecret = key => /key|token|secret|password|authorization/i.test(key) && !['apiKeyHelper', 'env_key', 'env_key_instructions'].includes(key);
    const parse = text => result.software === 'claude' ? JSON.parse(text) : parseToml(text);
    const gather = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string' && isSecret(key)) { if (item) secrets.add(item); }
        else gather(item);
      }
    };
    for (const text of [result.before, result.content, ...result.legacyFiles.flatMap(item => [item.before, item.content])]) if (text) gather(parse(text));
    const redactValue = value => {
      if (typeof value === 'string') {
        for (const secret of secrets) value = value.replaceAll(secret, '[密钥已隐藏]');
        return value;
      }
      if (Array.isArray(value)) return value.map(redactValue);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isSecret(key) && typeof item === 'string' && item ? '[密钥已隐藏]' : redactValue(item)]));
      return value;
    };
    const redact = (text, empty) => text === null ? empty : result.software === 'claude' ? JSON.stringify(redactValue(parse(text)), null, 2) + '\n' : stringifyToml(redactValue(parse(text)));
    const redactExtra = text => {
      if (text === null) return '（文件不存在／确认后删除）';
      try { return JSON.stringify(redactValue(JSON.parse(text)), null, 2); }
      catch { return '（非 JSON 原始文本，共 ' + text.length + ' 个字符；按预览操作替换／恢复）'; }
    };
    return { path: result.file, scope: result.scope, before: redact(result.before, '（文件不存在）'), after: redact(result.content, '（撤销后删除此文件）'), token: result.token, restore: result.restore, modelMapping: result.mapping, warnings: result.warnings, additionalFiles: result.additionalFiles.map(item => ({ path: item.file, before: redactExtra(item.before), after: redactExtra(item.content) })), legacyRestorations: result.legacyFiles.map(item => ({ path: item.file, before: redact(item.before, '（文件不存在）'), after: redact(item.content, '（撤销后删除此文件）') })) };
  }

  function atomicWrite(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (content === null) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }

  function apply(input, token) {
    const result = plan(input);
    if (!token || token !== result.token) throw new Error('配置、模型或密钥已变化，请重新预览后再确认');
    const oldHelper = read(helperFile);
    try {
      if (!result.restore) atomicWrite(helperFile, helperContent);
      for (const extra of result.additionalFiles) atomicWrite(extra.file, extra.content);
      for (const legacy of result.legacyFiles) atomicWrite(legacy.file, legacy.content);
      atomicWrite(result.file, result.content);
      atomicWrite(recordFile, JSON.stringify(result.records, null, 2) + '\n');
    } catch (error) {
      for (const extra of result.additionalFiles) atomicWrite(extra.file, extra.before);
      for (const legacy of result.legacyFiles) atomicWrite(legacy.file, legacy.before);
      atomicWrite(result.file, result.before);
      atomicWrite(recordFile, result.recordsText);
      atomicWrite(helperFile, oldHelper);
      throw error;
    }
    return { ok: true, path: result.file, scope: result.scope, restored: result.restore };
  }
  function state(modelId) {
    const records = JSON.parse(read(recordFile) || '{}');
    return Object.fromEntries([['claude', path.join(claudeHome, 'settings.json')], ['codex', path.join(codexHome, 'config.toml')]].map(([software, file]) => {
      const record = records[hash(path.resolve(file))];
      return [software, record?.modelId === modelId ? { selectedModel: record.selectedModel, modelMapping: record.modelMapping } : null];
    }));
  }
  return { preview, apply, state };
}
