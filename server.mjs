import http from 'node:http';
import { createPluginStore } from './plugins.mjs';
import { hookEvents, validateHook, hookGroup, mergeHookGroups, testHook, assertHookDestination } from './hooks.mjs';
import { validateRule, renderRule, parseRule } from './rules.mjs';
import { scanProjectAssets } from './project-import.mjs';
import { parseHookConfiguration } from './hook-import.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = process.env.ASSET_DATA_DIR || path.join(os.homedir(), 'Agent_assets_manager');
const repo = path.join(dataRoot, 'repo');
const privateDir = path.join(dataRoot, 'private');
const plugins = createPluginStore(dataRoot);
const keysFile = path.join(privateDir, 'keys.json');
const pathsFile = path.join(privateDir, 'project-paths.json');
const importsFile = path.join(privateDir, 'project-imports.json');
const envFile = path.join(privateDir, 'agent-env.json');
const activeFile = path.join(privateDir, 'active-versions.json');
const syncFile = path.join(privateDir, 'sync.json');
const mergeDir = path.join(privateDir, 'sync-merge');
const types = new Set(['skill', 'workflow', 'prompt', 'agent', 'hook', 'hookgroup', 'rule', 'project', 'model', 'settings']);
const profiledTypes = new Set(['skill', 'workflow', 'prompt', 'agent']);
const profileFields = {
  skill: ['description', 'variants', 'files'],
  workflow: ['description', 'members', 'skillIds'],
  prompt: ['description', 'scope', 'target', 'content'],
  agent: ['description', 'harness', 'modelId', 'instructions', 'skillIds', 'workflowIds', 'promptIds', 'hookIds', 'hookGroupIds', 'ruleIds', 'tools', 'mcps']
};
const port = Number(process.env.PORT || 8073);
const localAddresses = () => Object.values(os.networkInterfaces()).flat().filter(address => address.family === 'IPv4').map(address => address.address);
const assetPath = (type, id) => path.join(repo, 'assets', type, `${id}.json`);
const now = () => new Date().toISOString();

function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Git 执行失败').trim());
  return result.stdout.trimEnd();
}
function gitAt(cwd, args, options = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000, ...options });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Git 执行失败').trim());
  return result.stdout.trimEnd();
}
function gitSucceeds(cwd, args) { return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120000 }).status === 0; }
function assertNoMerge() { if (fs.existsSync(path.join(mergeDir, '.git'))) throw new Error('远程同步有待处理的冲突，请先完成冲突处理'); }
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw new Error(`旧资产库包含暂不支持的特殊文件：${from}`);
  }
}
function ensureData() {
  const legacy = path.join(root, '.asset-data');
  if (!process.env.ASSET_DATA_DIR && !fs.existsSync(dataRoot) && fs.existsSync(path.join(legacy, 'repo', '.git'))) {
    try { fs.renameSync(legacy, dataRoot); }
    catch (error) {
      if (error.code !== 'EXDEV') throw error;
      const staging = `${dataRoot}.importing-${crypto.randomUUID()}`;
      copyDirectory(legacy, staging);
      if (!fs.existsSync(path.join(staging, 'repo', '.git'))) throw new Error('旧资产库复制未完成，已保留原始数据');
      fs.renameSync(staging, dataRoot);
    }
  }
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(privateDir, { recursive: true });
  if (!fs.existsSync(path.join(repo, '.git'))) {
    git(['init']);
    git(['config', 'user.name', 'Agent Asset Manager']);
    git(['config', 'user.email', 'agent-assets@localhost']);
    fs.writeFileSync(path.join(repo, '.gitignore'), '.DS_Store\n');
    git(['add', '.gitignore']);
    git(['commit', '-m', '初始化资产仓库']);
  }
  migrateLocalSettings();
}
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function safeType(type) { if (!types.has(type)) throw new Error('未知资产类型'); return type; }
function safeId(id) { if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('无效的资产 ID'); return id; }
function rawList(type) {
  safeType(type);
  const dir = path.join(repo, 'assets', type);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(x => x.endsWith('.json')).map(x => readJson(path.join(dir, x))).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function rawGet(type, id) { return readJson(assetPath(safeType(type), safeId(id))); }
function selectedHash(type, id) { return readJson(activeFile, {})[`${type}/${id}`]; }
function selectedAsset(type, asset) {
  if(!asset)return asset;
  const hash = selectedHash(type, asset.id);
  if (!hash) return asset;
  try {
    const relative = `assets/${type}/${asset.id}.json`;
    const old = JSON.parse(git(['show', `${hash}:${relative}`]));
    return { ...old, activeVersion: hash, latestUpdatedAt: asset.updatedAt };
  } catch { return asset; }
}
function localize(type, asset) {
  if (!asset) return asset;
  if (type === 'project') return { ...asset, directory: readJson(pathsFile, {})[asset.id] || '', pathAssigned: !!readJson(pathsFile, {})[asset.id] };
  if (type === 'agent') {
    const environments = readJson(envFile, {});
    return { ...asset, mcps: (asset.mcps || []).map(item => ({ ...item, env: environments[asset.id]?.[item.name] || {} })) };
  }
  return asset;
}
function list(type) { return rawList(type).map(asset => localize(type, selectedAsset(type, asset))); }
function get(type, id) { return localize(safeType(type), selectedAsset(type, rawGet(type, safeId(id)))); }
function migrateLocalSettings() {
  const paths = readJson(pathsFile, {}), environments = readJson(envFile, {});
  const changed = [];
  for (const project of rawList('project')) if (project.directory) {
    paths[project.id] ||= project.directory;
    delete project.directory;
    writeJson(assetPath('project', project.id), project);
    changed.push(`assets/project/${project.id}.json`);
  }
  for (const agent of rawList('agent')) {
    let modified = false;
    for (const mcp of agent.mcps || []) if (mcp.env && Object.keys(mcp.env).length) {
      environments[agent.id] ||= {};
      environments[agent.id][mcp.name] ||= mcp.env;
      delete mcp.env;
      modified = true;
    }
    if (modified) { writeJson(assetPath('agent', agent.id), agent); changed.push(`assets/agent/${agent.id}.json`); }
  }
  if (changed.length) {
    writeJson(pathsFile, paths); writeJson(envFile, environments);
    git(['add', '--', ...changed]);
    git(['commit', '-m', '迁移本机项目路径与 MCP 环境变量到私有配置']);
  }
}
function requireMessage(message) {
  if (typeof message !== 'string' || message.trim().length < 3) throw new Error('请填写至少 3 个字的版本说明');
  if (message.length > 200) throw new Error('版本说明不能超过 200 字');
  return message.trim();
}
function titleFor(type, asset) { return asset.title || asset.name || `${type} ${asset.id}`; }
function profileKey(harness, modelId) { return `${harness}:${modelId}`; }
function profileSnapshot(type, asset) { return Object.fromEntries(profileFields[type].filter(field => Object.hasOwn(asset, field)).map(field => [field, structuredClone(asset[field])])); }
function forProfile(type, asset, harness, modelId) {
  if (!asset) return asset;
  if (!asset.profiles || !Object.keys(asset.profiles).length) return asset; // Legacy assets retain their original content until configured.
  const profile = asset.profiles[profileKey(harness, modelId)];
  if (!profile) throw new Error(`${titleFor(type, asset)} 尚无此 Harness 框架与模型版本的资产配置`);
  const selected = { ...asset, ...structuredClone(profile) };
  if (type === 'agent') {
    const environments = readJson(envFile, {});
    selected.mcps = (selected.mcps || []).map(item => ({ ...item, env: environments[asset.id]?.[item.name] || {} }));
  }
  return selected;
}
function validateAsset(type, a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('资产内容无效');
  if (!String(a.title || a.name || '').trim()) throw new Error('请填写名称');
  if (type === 'hook') validateHook(a);
  if (type === 'rule') validateRule(a);
  if (type === 'hookgroup') {
    if(!['claude','codex'].includes(a.harness))throw Error('请选择 Hooks 组的目标软件');
    if(!String(a.description||'').trim())throw Error('请填写 Hooks 组的共同用途');
    if(!Array.isArray(a.members)||!a.members.length||a.members.length>100)throw Error('Hooks 组需包含 1–100 个成员');
    const ids=new Set();
    for(const member of a.members) {
      const hook=member?.hookId?get('hook',member.hookId):null;
      if(!hook||hook.harness!==a.harness)throw Error('Hooks 组包含已删除或不适用于此软件的 Hook');
      if(ids.has(member.hookId))throw Error('Hooks 组中不能重复选择同一个 Hook');
      if(member.role!==undefined&&(typeof member.role!=='string'||member.role.length>2000))throw Error('成员作用需为不超过 2000 字的文本');
      ids.add(member.hookId);
    }
  }
  if (type === 'skill') {
    if (!a.variants || typeof a.variants !== 'object') throw new Error('Skill 缺少模板');
    for (const [software, variant] of Object.entries(a.variants)) {
      const issues = validateSkill(variant, software);
      if (issues.length) throw new Error(`${software} 模板：${issues.join('；')}`);
    }
    for (const [name, content] of Object.entries(a.files || {})) {
      safeResourcePath(name);
      if (typeof content !== 'string' && !(content && content.encoding === 'base64' && typeof content.data === 'string')) throw new Error(`资源内容无效：${name}`);
    }
  }
  if (type === 'project') {
    if (a.directory && !path.isAbsolute(a.directory)) throw new Error('本机项目目录必须是绝对路径');
    if (a.suiteIds && (!Array.isArray(a.suiteIds) || a.suiteIds.some(id => !get('workflow', id)))) throw new Error('项目包含无效的 Skills 套件');
    if (a.ruleIds !== undefined && (!Array.isArray(a.ruleIds) || a.ruleIds.some(id => !get('rule', id)))) throw new Error('项目包含不存在的 Rule');
  }
  if (type === 'model') {
    const url = new URL(a.baseUrl || '');
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('API 地址必须是 HTTP 或 HTTPS');
    if (!a.model) throw new Error('请填写模型 ID');
  }
  if (type === 'workflow') {
    if (a.members && !String(a.description || '').trim()) throw new Error('请填写套件用途');
    const members = a.members || (a.skillIds || []).map(skillId => ({ skillId, role: '' }));
    if (!Array.isArray(members) || !members.length) throw new Error('套件至少需要一个现有 Skill');
    if (members.some(item => !item?.skillId || !get('skill', item.skillId))) throw new Error('套件包含无效的 Skill');
    if (new Set(members.map(item => item.skillId)).size !== members.length) throw new Error('套件中不能重复选择同一个 Skill');
    if (a.members && members.some(item => !String(item.role || '').trim())) throw new Error('请填写每个 Skill 在套件中的定位和作用');
  }
  if (type === 'agent') {
    if (!Array.isArray(a.skillIds) || !Array.isArray(a.workflowIds) || !Array.isArray(a.tools) || !Array.isArray(a.mcps)) throw new Error('Agent 配置无效');
    if (a.hookIds !== undefined && (!Array.isArray(a.hookIds) || a.hookIds.some(id => !get('hook', id) || get('hook', id).harness !== a.harness))) throw new Error('Agent 包含不存在或不适用于此软件的 Hook');
    if(a.hookGroupIds!==undefined&&(!Array.isArray(a.hookGroupIds)||a.hookGroupIds.some(id=>!get('hookgroup',id)||get('hookgroup',id).harness!==a.harness)))throw Error('Agent 包含不存在或不适用于此软件的 Hooks 组');
    if (a.ruleIds !== undefined && (!Array.isArray(a.ruleIds) || (a.ruleIds.length && a.harness !== 'claude') || a.ruleIds.some(id => !get('rule', id)))) throw new Error('Agent 的 Rules 仅适用于 Claude Code，且必须引用现有规则');
    if (a.harness && !['claude', 'codex'].includes(a.harness)) throw new Error('Agent 的 Harness 框架无效');
    if (a.mcps.some(x => !x.name || !x.command || !Array.isArray(x.args || []))) throw new Error('MCP 服务器需要名称和启动命令');
  }
  if (type === 'prompt' && !['global', 'model', 'software', 'project'].includes(a.scope)) throw new Error('提示词层级无效');
  if (type === 'prompt' && a.scope !== 'global' && !a.target) throw new Error('请选择提示词的适用对象');
  if (type === 'prompt' && !String(a.content || '').trim()) throw new Error('提示词正文不能为空');
}
function save(type, input, message) {
  assertNoMerge();
  safeType(type); requireMessage(message);
  const id = input.id ? safeId(input.id) : crypto.randomUUID();
  const old = rawGet(type, id);
  const asset = { ...input, id, type, createdAt: old?.createdAt || now(), updatedAt: now() };
  delete asset.apiKey;
  if (profiledTypes.has(type) && (asset.assetHarness || asset.assetModelId || old?.profiles)) {
    if (!['claude', 'codex'].includes(asset.assetHarness)) throw new Error('请选择资产的 Harness 框架');
    if (!asset.assetModelId || !rawGet('model', safeId(asset.assetModelId))) throw new Error('请选择模型服务中已配置的模型版本');
    if (type === 'prompt' && asset.scope === 'model' && asset.target !== asset.assetModelId) throw new Error('模型层提示词的适用模型应与资产模型版本一致');
    if (type === 'prompt' && asset.scope === 'software' && asset.target !== asset.assetHarness) throw new Error('Harness 层提示词的适用框架应与资产框架一致');
  }
  if (type === 'agent' && asset.assetHarness && asset.assetModelId) { asset.harness = asset.assetHarness; asset.modelId = asset.assetModelId; }
  validateAsset(type, asset);
  if (type === 'project') {
    const paths = readJson(pathsFile, {});
    if (asset.directory) paths[id] = asset.directory;
    else delete paths[id];
    writeJson(pathsFile, paths);
    delete asset.directory;
    delete asset.pathAssigned;
  }
  if (type === 'agent') {
    const environments = readJson(envFile, {});
    const localEnv = {};
    for (const mcp of asset.mcps || []) {
      if (mcp.env && Object.keys(mcp.env).length) localEnv[mcp.name] = mcp.env;
      delete mcp.env;
    }
    if (Object.keys(localEnv).length) environments[id] = { ...(environments[id] || {}), ...localEnv };
    writeJson(envFile, environments);
  }
  if (profiledTypes.has(type) && (asset.assetHarness || asset.assetModelId || old?.profiles)) {
    asset.profiles = { ...(old?.profiles || {}), [profileKey(asset.assetHarness, asset.assetModelId)]: profileSnapshot(type, asset) };
  }
  delete asset.activeVersion;
  delete asset.latestUpdatedAt;
  const file = assetPath(type, id);
  writeJson(file, asset);
  git(['add', path.relative(repo, file).replaceAll('\\', '/')]);
  git(['commit', '-m', `${type}: ${titleFor(type, asset)} — ${message.trim()}`]);
  const active = readJson(activeFile, {});
  delete active[`${type}/${id}`];
  writeJson(activeFile, active);
  if (type === 'model' && typeof input.apiKey === 'string' && input.apiKey.trim()) {
    const keys = readJson(keysFile, {});
    keys[id] = input.apiKey.trim();
    writeJson(keysFile, keys);
  }
  return { ...localize(type, asset), hasKey: type === 'model' ? !!readJson(keysFile, {})[id] : undefined };
}
function remove(type, id, message) {
  assertNoMerge();
  requireMessage(message);
  const file = assetPath(safeType(type), safeId(id));
  if (!fs.existsSync(file)) throw new Error('资产不存在');
  fs.unlinkSync(file);
  git(['add', '-A', path.relative(repo, file).replaceAll('\\', '/')]);
  git(['commit', '-m', `${type}: 删除资产 — ${message.trim()}`]);
  if (type === 'model') { const keys = readJson(keysFile, {}); delete keys[id]; writeJson(keysFile, keys); }
  const active = readJson(activeFile, {}); delete active[`${type}/${id}`]; writeJson(activeFile, active);
  return { ok: true };
}
function history(type, id) {
  const rel = path.relative(repo, assetPath(safeType(type), safeId(id))).replaceAll('\\', '/');
  const raw = git(['log', '--format=%H%x1f%h%x1f%aI%x1f%s%x1e', '--', rel]);
  return raw.split('\x1e').filter(Boolean).map(row => { const [hash, short, date, message] = row.trim().split('\x1f'); return { hash, short, date, message }; });
}
function recentVersions() {
  return [...types].flatMap(type => list(type).flatMap(asset => history(type, asset.id).map(entry => ({ ...entry, type, id: asset.id, title: titleFor(type, asset) })))).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 12);
}
function trash(type) {
  safeType(type);
  const directory = `assets/${type}`;
  const deleted = git(['log', '--all', '--diff-filter=D', '--name-only', '--format=', '--', directory]);
  const paths = [...new Set(deleted.split(/\r?\n/).filter(x => x.startsWith(`${directory}/`) && x.endsWith('.json')))];
  return paths.filter(rel => !fs.existsSync(path.join(repo, rel))).map(rel => {
    const id = path.basename(rel, '.json');
    const hashes = git(['log', '--all', '--format=%H', '--', rel]).split(/\r?\n/).filter(Boolean);
    for (const hash of hashes) {
      try { const asset = JSON.parse(git(['show', `${hash}:${rel}`])); return { id, title: titleFor(type, asset), hash }; } catch {}
    }
    return null;
  }).filter(Boolean);
}
function diff(type, id, hash) {
  if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error('无效版本');
  const rel = path.relative(repo, assetPath(safeType(type), safeId(id))).replaceAll('\\', '/');
  return git(['show', '--format=', '--find-renames', hash, '--', rel]);
}
function restore(type, id, hash, message) {
  assertNoMerge();
  requireMessage(message);
  if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error('无效版本');
  const rel = path.relative(repo, assetPath(safeType(type), safeId(id))).replaceAll('\\', '/');
  const content = git(['show', `${hash}:${rel}`]);
  const parsed = JSON.parse(content);
  parsed.updatedAt = now();
  validateAsset(type, parsed);
  writeJson(assetPath(type, id), parsed);
  git(['add', rel]);
  git(['commit', '-m', `${type}: 回滚 ${titleFor(type, parsed)} — ${message.trim()}`]);
  return parsed;
}
function selectVersion(type, id, hash) {
  safeType(type); safeId(id);
  if (!rawGet(type, id)) throw new Error('资产不存在');
  const active = readJson(activeFile, {});
  if (hash) {
    if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error('无效版本');
    const item = JSON.parse(git(['show', `${hash}:assets/${type}/${id}.json`]));
    if (item.id !== id) throw new Error('历史版本与资产不匹配');
    active[`${type}/${id}`] = hash;
  } else delete active[`${type}/${id}`];
  writeJson(activeFile, active);
  return get(type, id);
}
function setProjectPath(id, directory) {
  safeId(id);
  if (!rawGet('project', id)) throw new Error('项目不存在');
  if (directory && !path.isAbsolute(directory)) throw new Error('请选择本机绝对路径');
  if (directory && !fs.existsSync(directory)) throw new Error('本机项目目录不存在');
  const paths = readJson(pathsFile, {});
  if (directory) paths[id] = directory; else delete paths[id];
  writeJson(pathsFile, paths);
  return get('project', id);
}
let pickerPending = null;
function chooseProjectDirectory(initial = '') {
  if (pickerPending) return pickerPending;
  pickerPending = new Promise((resolve, reject) => {
    let command, args;
    if (process.platform === 'win32') {
      const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$shell = New-Object -ComObject Shell.Application
$folder = $shell.BrowseForFolder(0, '选择本机项目文件夹', 0)
if ($folder) { [Console]::WriteLine($folder.Self.Path) }`;
      command = 'powershell.exe';
      args = ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
    } else if (process.platform === 'darwin') { command = 'osascript'; args = ['-e', 'POSIX path of (choose folder with prompt "选择本机项目文件夹")']; }
    else { command = 'zenity'; args = ['--file-selection', '--directory', '--title=选择本机项目文件夹']; }
    const child = spawn(command, args, { windowsHide: false, env: { ...process.env, AGENT_PICKER_INITIAL: String(initial || '') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk.toString('utf8'));
    child.stderr.on('data', chunk => stderr += chunk.toString('utf8'));
    child.on('error', error => reject(new Error(`无法打开文件夹选择窗口：${error.message}`)));
    child.on('close', code => {
      if (code !== 0 && !/User canceled|Cancelled/i.test(stderr)) return reject(new Error(`文件夹选择失败：${stderr.trim() || `退出码 ${code}`}`));
      const directory = stdout.trim();
      if (directory && (!path.isAbsolute(directory) || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory())) return reject(new Error('所选目录无效，请重新选择'));
      resolve({ directory });
    });
  }).finally(() => { pickerPending = null; });
  return pickerPending;
}
function syncConfig() { return readJson(syncFile, {}); }
function remoteUrl() { try { return git(['remote', 'get-url', 'origin']); } catch { return ''; } }
function validateRemoteUrl(url) {
  const value = String(url || '').trim();
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(value) && !/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(value)) throw new Error('请输入 GitHub 仓库的 HTTPS 或 SSH 地址');
  if (value.includes('@') && !value.startsWith('git@')) throw new Error('仓库地址中不能包含凭据');
  return value.replace(/\/$/, '');
}
function auditPrivateHistory() {
  const commits = git(['log', '--all', '--format=%H', '--', 'assets/project', 'assets/agent']).split(/\r?\n/).filter(Boolean);
  for (const hash of commits) {
    const files = git(['ls-tree', '-r', '--name-only', hash, '--', 'assets/project', 'assets/agent']).split(/\r?\n/).filter(Boolean);
    for (const file of files) {
      const asset = JSON.parse(git(['show', `${hash}:${file}`]));
      if (file.startsWith('assets/project/') && asset.directory) throw new Error('旧版本历史包含本机项目路径。为避免上传本机信息，请先迁移这段历史。');
      if (file.startsWith('assets/agent/') && (asset.mcps || []).some(item => item.env && Object.keys(item.env).length)) throw new Error('旧版本历史包含 MCP 环境变量。为避免上传密钥，请先清理这段历史。');
    }
  }
}
function syncStatus() {
  const config = syncConfig(), url = remoteUrl();
  if (!url) return { connected: false, dataRoot };
  const branch = config.branch || 'main';
  const remoteRef = `refs/remotes/origin/${branch}`;
  let ahead = 0, behind = 0;
  if (gitSucceeds(repo, ['rev-parse', '--verify', remoteRef])) {
    const counts = git(['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]).trim().split(/\s+/).map(Number);
    [ahead, behind] = counts;
  }
  return { connected: true, url, branch, ahead, behind, conflict: fs.existsSync(path.join(mergeDir, '.git')), dataRoot };
}
function connectRemote(inputUrl) {
  assertNoMerge();
  auditPrivateHistory();
  const url = validateRemoteUrl(inputUrl);
  const heads = gitAt(repo, ['ls-remote', '--symref', url, 'HEAD', 'refs/heads/*']);
  const symbolic = heads.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD/m)?.[1];
  const branch = symbolic || heads.match(/refs\/heads\/([^\s]+)/)?.[1] || 'main';
  const current = remoteUrl();
  if (current) git(['remote', 'set-url', 'origin', url]); else git(['remote', 'add', 'origin', url]);
  writeJson(syncFile, { branch });
  if (heads) {
    gitAt(repo, ['fetch', 'origin', branch]);
    const localAssets = [...types].some(type => rawList(type).length);
    const localCount = Number(git(['rev-list', '--count', 'HEAD']));
    if (!localAssets && localCount === 1) git(['checkout', '-B', branch, `refs/remotes/origin/${branch}`]);
    else if (!gitSucceeds(repo, ['merge-base', 'HEAD', `refs/remotes/origin/${branch}`])) throw new Error('本地与远程是两个独立的资产历史，无法自动合并。请使用空仓库连接现有本地资产。');
  } else git(['branch', '-M', branch]);
  return syncStatus();
}
function conflictItems() {
  if (!fs.existsSync(path.join(mergeDir, '.git'))) return [];
  const lines = gitAt(mergeDir, ['ls-files', '--unmerged']);
  const paths = [...new Set(lines.split(/\r?\n/).filter(Boolean).map(line => line.split('\t')[1]))];
  return paths.map(file => {
    const match = file.match(/^assets\/([a-z]+)\/([a-f0-9-]{36})\.json$/);
    const read = stage => { try { return gitAt(mergeDir, ['show', `:${stage}:${file}`]); } catch { return ''; } };
    const ours = read(2), theirs = read(3);
    let title = file;
    try { title = JSON.parse(ours || theirs).title || file; } catch {}
    return { path: file, type: match?.[1] || '', id: match?.[2] || '', title, local: ours, remote: theirs };
  });
}
function finishMerge(branch) {
  const merged = gitAt(mergeDir, ['rev-parse', 'HEAD']);
  try { gitAt(mergeDir, ['push', 'origin', `HEAD:refs/heads/${branch}`]); }
  catch (error) { git(['worktree', 'remove', '--force', mergeDir]); throw error; }
  git(['merge', '--ff-only', merged]);
  git(['worktree', 'remove', '--force', mergeDir]);
  return syncStatus();
}
function syncRemote() {
  assertNoMerge();
  auditPrivateHistory();
  const { connected, branch } = syncStatus();
  if (!connected) throw new Error('请先连接 GitHub 仓库');
  if (git(['status', '--porcelain'])) throw new Error('资产仓库有未提交的文件，请先处理');
  if (!gitAt(repo, ['ls-remote', '--heads', 'origin', branch])) {
    gitAt(repo, ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`]);
    return syncStatus();
  }
  gitAt(repo, ['fetch', 'origin', branch]);
  const remoteRef = `refs/remotes/origin/${branch}`;
  if (!gitSucceeds(repo, ['rev-parse', '--verify', remoteRef])) {
    gitAt(repo, ['push', '-u', 'origin', `HEAD:refs/heads/${branch}`]);
    return syncStatus();
  }
  if (gitSucceeds(repo, ['merge-base', '--is-ancestor', remoteRef, 'HEAD'])) {
    gitAt(repo, ['push', 'origin', `HEAD:refs/heads/${branch}`]);
    return syncStatus();
  }
  if (gitSucceeds(repo, ['merge-base', '--is-ancestor', 'HEAD', remoteRef])) {
    git(['merge', '--ff-only', remoteRef]);
    return syncStatus();
  }
  git(['worktree', 'add', '--detach', mergeDir, 'HEAD']);
  const result = spawnSync('git', ['merge', '--no-edit', remoteRef], { cwd: mergeDir, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) {
    const conflicts = conflictItems();
    if (conflicts.length) return { ...syncStatus(), conflicts };
    git(['worktree', 'remove', '--force', mergeDir]);
    throw new Error((result.stderr || result.stdout || '合并失败').trim());
  }
  return finishMerge(branch);
}
function resolveConflicts(choices) {
  if (!fs.existsSync(path.join(mergeDir, '.git'))) throw new Error('没有待处理的冲突');
  const conflicts = conflictItems();
  for (const item of conflicts) {
    const choice = choices?.[item.path];
    if (!['local', 'remote'].includes(choice)) throw new Error(`请为「${item.title}」选择本机或远程版本`);
  }
  for (const item of conflicts) {
    const stage = choices[item.path] === 'local' ? 2 : 3;
    const content = stage === 2 ? item.local : item.remote;
    const destination = path.join(mergeDir, item.path);
    if (content) { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, content, 'utf8'); }
    else if (fs.existsSync(destination)) fs.unlinkSync(destination);
    gitAt(mergeDir, ['add', '-A', '--', item.path]);
  }
  gitAt(mergeDir, ['commit', '-m', '合并本机与远程资产版本']);
  return finishMerge(syncConfig().branch || 'main');
}
function safeResourcePath(name) {
  if (typeof name !== 'string' || !/^(scripts|references|assets)\//.test(name) || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`无效资源路径：${name}`);
  return name;
}
function parseImportedSkill(source) {
  if (typeof source !== 'string' || source.length > 512_000) throw new Error('SKILL.md 无效或超过 500 KB');
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') throw new Error('SKILL.md 必须以 YAML front matter 开始');
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close < 0) throw new Error('SKILL.md 缺少 YAML front matter 结束标记');
  const document = YAML.parseDocument(lines.slice(1, close).join('\n'), { uniqueKeys: true, strict: true });
  if (document.errors.length) throw new Error(`YAML 解析失败：${document.errors[0].message}`);
  const frontmatter = document.toJS();
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) throw new Error('YAML front matter 必须是字段映射');
  const body = lines.slice(close + 1).join('\n').trim();
  if (!body) throw new Error('SKILL.md 正文不能为空');
  return { frontmatter, body, unknownFields: Object.keys(frontmatter).filter(key => ![...standardFields, ...claudeFields].includes(key)) };
}
const standardFields = ['name', 'description', 'license', 'compatibility', 'metadata'];
const claudeFields = ['allowed-tools', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable', 'disallowed-tools', 'model', 'effort', 'context', 'agent', 'paths', 'shell'];
const legacySkillFields = ['allowed-tools', 'background'];
function validateSkill(v, software = 'common') {
  const f = v?.frontmatter || {};
  const issues = [];
  if (software !== 'claude' || f.name) if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(f.name || '') || f.name.length > 64) issues.push('name 需为 1–64 位小写字母、数字或连字符');
  if (software !== 'claude' || f.description) if (!String(f.description || '').trim() || String(f.description).length > 1024) issues.push('description 需为 1–1024 字符');
  if (f.compatibility && String(f.compatibility).length > 500) issues.push('compatibility 不得超过 500 字符');
  if (f.metadata && (typeof f.metadata !== 'object' || Array.isArray(f.metadata) || Object.values(f.metadata).some(x => typeof x !== 'string'))) issues.push('metadata 必须是字符串键值映射');
  if (software !== 'claude' && Object.keys(f).some(k => ![...standardFields, ...legacySkillFields].includes(k))) issues.push('此模板包含不支持的字段');
  if (software === 'claude' && Object.keys(f).some(k => ![...standardFields, ...claudeFields, 'background'].includes(k))) issues.push('包含未知字段');
  if (!String(v?.body || '').trim()) issues.push('正文不能为空');
  return issues;
}
function yamlScalar(x) { return JSON.stringify(String(x)); }
function renderSkill(v, software = 'common') {
  const f = v.frontmatter;
  const fields = software === 'claude' ? [...standardFields, ...claudeFields] : standardFields;
  const lines = ['---'];
  for (const key of fields) {
    const value = f[key];
    if (value === undefined || value === null || value === '') continue;
    if (key === 'metadata') {
      if (!Object.keys(value).length) continue;
      lines.push('metadata:');
      for (const [k, v] of Object.entries(value)) lines.push(`  ${yamlScalar(k)}: ${yamlScalar(v)}`);
    } else if (typeof value === 'boolean') lines.push(`${key}: ${value}`);
    else lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push('---', '', v.body.trim(), '');
  return lines.join('\n');
}
function getVariant(skill, software) { return skill.variants?.[software] || skill.variants?.common || Object.values(skill.variants || {})[0]; }
function composedPrompt(config) {
  const { modelId, software, projectId, promptIds = [] } = config;
  if (!modelId && promptIds.some(id => get('prompt', id)?.profiles && Object.keys(get('prompt', id).profiles).length)) throw new Error('请选择模型版本以匹配系统提示词');
  const all = list('prompt').flatMap(item => {
    try { return [forProfile('prompt', item, software, modelId)]; } catch { return []; }
  });
  if (!Array.isArray(promptIds)) throw new Error('系统提示词选择无效');
  const eligible = p => p.scope === 'global' || (p.scope === 'model' && p.target === modelId) || (p.scope === 'software' && p.target === software) || (p.scope === 'project' && p.target === projectId);
  const explicit = Object.hasOwn(config, 'promptIds');
  const selected = explicit ? all.filter(p => promptIds.includes(p.id)) : all.filter(p => eligible(p) || (config.additionalPromptIds || []).includes(p.id));
  if (explicit && selected.length !== new Set(promptIds).size) throw new Error('选择的系统提示词不存在');
  if (explicit && selected.some(p => !eligible(p))) throw new Error('系统提示词与目标项目、模型或 Harness 不匹配');
  const order = { global: 0, model: 1, software: 2, project: 3 };
  selected.sort((a,b) => order[a.scope] - order[b.scope] || a.title.localeCompare(b.title));
  return { layers: selected.map(x => ({ id:x.id, title:x.title, scope:x.scope })), text: selected.map(x => `## ${x.title}\n\n${x.content || ''}`).join('\n\n') };
}
function assertProject(projectId) {
  const project = get('project', projectId);
  if (!project) throw new Error('项目不存在');
  if (!project.directory) throw new Error('该项目尚未分配本机路径，请先在「项目」中设置');
  const stat = fs.existsSync(project.directory) && fs.statSync(project.directory);
  if (!stat?.isDirectory()) throw new Error('项目目录不存在，请先创建该目录');
  return project;
}
function managedBlock(content) {
  const start = '<!-- Agent Asset Manager: start -->';
  const end = '<!-- Agent Asset Manager: end -->';
  return content.trim() ? `${start}\n${content.trim()}\n${end}\n` : '';
}
function managedTomlBlock(existing, content) {
  const start = '# Agent Asset Manager: start';
  const end = '# Agent Asset Manager: end';
  const block = `${start}\n${content.trim()}\n${end}`;
  if (existing.includes(start) && existing.includes(end)) return existing.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  return [existing.trimEnd(), block, ''].filter(Boolean).join('\n\n');
}
function tomlString(value) { return JSON.stringify(String(value)); }
function suiteMembers(suite) { return suite.members || (suite.skillIds || []).map(skillId => ({ skillId, role: '' })); }
function makeDeployment(body) {
  const project = assertProject(body.projectId);
  const software = body.software;
  if (!['claude', 'codex'].includes(software)) throw new Error('请选择 Claude Code 或 Codex');
  const agentAsset = body.agentId ? get('agent', body.agentId) : null;
  const modelId = body.modelId || (agentAsset?.profiles && Object.keys(agentAsset.profiles).length ? '' : agentAsset?.modelId || '');
  if (modelId && !rawGet('model', safeId(modelId))) throw new Error('所选模型版本不存在');
  const agent = body.agentId ? forProfile('agent', get('agent', body.agentId), software, modelId) : null;
  if (body.agentId && !agent) throw new Error('Agent 不存在');
  if (agent?.harness && agent.harness !== software) throw new Error(`此 Agent 适用于 ${agent.harness === 'claude' ? 'Claude Code' : 'Codex'}，请切换目标软件`);
  const selectedSuiteIds = body.suiteIds === undefined ? (project.suiteIds || []) : body.suiteIds;
  if (!Array.isArray(selectedSuiteIds)) throw new Error('Skills 套件选择无效');
  if (body.skillIds !== undefined && !Array.isArray(body.skillIds)) throw new Error('单个 Skills 选择无效');
  const suiteIds = [...new Set([...(agent?.workflowIds || []), ...selectedSuiteIds])];
  const directSkillIds = [...new Set([...(agent?.skillIds || []), ...(body.skillIds || [])])];
  const skills = directSkillIds.map(id => forProfile('skill', get('skill', id), software, modelId));
  if (skills.some(x => !x)) throw new Error('选择的 Skill 不存在');
  const suites = suiteIds.map(id => forProfile('workflow', get('workflow', id), software, modelId));
  if (suites.some(x => !x)) throw new Error('选择的 Skills 套件不存在');
  const selected = new Map(skills.map(x => [x.id, x]));
  for (const suite of suites) for (const member of suiteMembers(suite)) {
    const skill = forProfile('skill', get('skill', member.skillId), software, modelId);
    if (!skill) throw new Error(`套件 ${suite.title} 引用了已删除的 Skill`);
    selected.set(member.skillId, skill);
  }
  const projectRoot = project.directory;
  const manifestPath = path.join(projectRoot, '.agent-asset-manager', `${software}.json`);
  const previous = readJson(manifestPath, { files: [], tools: [], mcps: [] });
  for (const [file, hash] of Object.entries(previous.ruleFiles || {})) {
    assertHookDestination(projectRoot, file);
    if (fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash) throw new Error('助手管理的 Rule 已在项目中修改，请先保存修改或恢复原文件');
  }
  if (body.ruleIds !== undefined && !Array.isArray(body.ruleIds)) throw new Error('Rules 选择无效');
  const ruleIds = [...new Set([...(agent?.ruleIds || []), ...(body.ruleIds ?? (software === 'claude' ? project.ruleIds || [] : []))])];
  if (ruleIds.length && software !== 'claude') throw new Error('Rules 仅支持 Claude Code');
  const rules = ruleIds.map(id => get('rule', id));
  if (rules.some(rule => !rule)) throw new Error('所选 Rule 不存在');
  for (const [file, hash] of Object.entries(previous.hookFiles || {})) {
    assertHookDestination(projectRoot, file);
    if (fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash) throw new Error('助手管理的 Hook 文件已在项目中修改，请先将修改保存到资产或恢复原文件');
  }
  if (body.hookIds !== undefined && !Array.isArray(body.hookIds)) throw new Error('Hooks 选择无效');
  if(body.hookGroupIds!==undefined&&!Array.isArray(body.hookGroupIds))throw Error('Hooks 组选择无效');
  const hookGroupIds=[...new Set([...(agent?.hookGroupIds||[]),...(body.hookGroupIds||[])])];
  const hookGroups=hookGroupIds.map(id=>get('hookgroup',id));
  for(const group of hookGroups) {
    if(!group||group.harness!==software)throw Error('所选 Hooks 组不存在或不适用于目标软件');
    validateAsset('hookgroup',group);
  }
  const directHookIds=[...new Set(body.hookIds||[])];
  const hookIds = [...new Set([...(agent?.hookIds || []), ...directHookIds, ...hookGroups.flatMap(group=>group.members.map(member=>member.hookId))])];
  const hooks = hookIds.map(id => get('hook', id));
  if (hooks.some(a => !a || a.harness !== software)) throw new Error('所选 Hook 不存在或不适用于目标软件');
  const skillRoot = path.join(projectRoot, software === 'claude' ? '.claude/skills' : '.agents/skills');
  const files = [];
  for (const rule of rules) {
    validateRule(rule);
    const directory = path.join(projectRoot, '.claude', 'rules', 'asset-manager', rule.id);
    const marker = path.join(directory, '.agent-asset-id');
    const target = path.join(directory, rule.fileName);
    assertHookDestination(projectRoot, marker);
    assertHookDestination(projectRoot, target);
    if (fs.existsSync(directory) && (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== rule.id)) throw new Error('目标已有非本助手管理的 Rule 目录');
    if (fs.existsSync(target) && !(previous.files || []).includes(target)) throw new Error('规则目标文件未在助手生效记录中，已停止覆盖');
    files.push({path:target,content:renderRule(rule)}, {path:marker,content:rule.id+'\n'});
  }
  const names = new Set();
  for (const skill of selected.values()) {
    const variant = getVariant(skill, software);
    const issues = validateSkill(variant, software);
    if (issues.length) throw new Error(`${skill.title}：${issues.join('；')}`);
    const name = variant.frontmatter.name || skill.variants.common?.frontmatter.name;
    if (names.has(name)) throw new Error(`Skill 名称冲突：${name}`);
    names.add(name);
    const dir = path.join(skillRoot, name);
    const marker = path.join(dir, '.agent-asset-id');
    if (fs.existsSync(dir) && (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== skill.id)) throw new Error(`目标已有非本助手管理的 Skill：${dir}`);
    files.push({ path: path.join(dir, 'SKILL.md'), content: renderSkill(variant, software) });
    files.push({ path: marker, content: skill.id + '\n' });
    for (const [name, content] of Object.entries(skill.files || {})) files.push({ path: path.join(dir, safeResourcePath(name)), content: typeof content === 'string' ? content : Buffer.from(content.data, 'base64') });
  }
  const promptConfig = { modelId, software, projectId: project.id };
  if (body.promptIds !== undefined) promptConfig.promptIds = body.promptIds;
  else if (agent?.promptIds?.length) promptConfig.additionalPromptIds = agent.promptIds;
  const prompt = composedPrompt(promptConfig);
  if (!agent && !suiteIds.length && !directSkillIds.length && !prompt.layers.length && !hooks.length && !rules.length && !(previous.ruleIds || []).length && !Object.keys(previous.hooks || {}).length) throw new Error('请选择 Agent、Skills、Hooks、Rules 或系统提示词');
  if (prompt.text) files.push({ path: path.join(projectRoot, '.agent-asset-manager', `${software}-system-prompt.md`), content: `# 系统提示词组合\n\n${prompt.text}\n` });
  const suiteInstructions = suites.map(suite => {
    const members = suiteMembers(suite).map(member => {
      const skill = forProfile('skill', get('skill', member.skillId), software, modelId);
      const name = getVariant(skill, software).frontmatter.name || skill.variants.common?.frontmatter.name;
      return `- \`${name}\`${member.role ? `：${member.role.trim()}` : ''}`;
    }).join('\n');
    return `### ${suite.title}\n用途：${suite.description || '按需使用下列 Skills。'}\n\n${members}`;
  }).join('\n\n');
  const instruction = [`# ${agent?.title || '项目配置'}`, prompt.text, agent?.instructions || '', (agent?.tools || []).length ? `允许使用的工具：${agent.tools.join('、')}` : '', suiteInstructions ? `## 已应用的 Skills 套件\n\n${suiteInstructions}` : ''].filter(Boolean).join('\n\n');
  const instructionPath = path.join(projectRoot, software === 'claude' ? 'CLAUDE.md' : 'AGENTS.md');
  const writeInstructions = content => {
    assertHookDestination(projectRoot, instructionPath);
    files.push({path:instructionPath,content:managedBlock(content),writeMode:'replace'});
  };
  if ((!rules.length && !(previous.ruleIds || []).length) || agent || selected.size || suites.length || prompt.text || previous.agentId || previous.skillIds?.length || previous.promptIds?.length) writeInstructions(instruction);
  else if ((previous.files || []).includes(instructionPath) && fs.existsSync(instructionPath)) writeInstructions('');
  const mcps = agent?.mcps || [];
  if (software === 'claude' && (agent || (previous.tools || []).length || fs.existsSync(path.join(projectRoot, '.claude', 'settings.json')))) {
    const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
    let settings;
    try { settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {}; } catch { throw new Error('现有项目设置不是有效 JSON，已停止生效'); }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('现有项目设置必须是 JSON 对象');
    settings.permissions = settings.permissions || {};
    settings.permissions.allow = [...new Set([...(settings.permissions.allow || []).filter(x => !(previous.tools || []).includes(x)), ...(agent?.tools || [])])];
    files.push({ path: settingsPath, content: JSON.stringify(settings, null, 2) + '\n' });
    if (mcps.length || (previous.mcps || []).length) {
      const mcpPath = path.join(projectRoot, '.mcp.json');
      const mcp = readJson(mcpPath, {});
      mcp.mcpServers = mcp.mcpServers || {};
      for (const name of previous.mcps || []) delete mcp.mcpServers[name];
      for (const item of mcps) mcp.mcpServers[item.name] = { command: item.command, args: item.args || [], ...(item.env && Object.keys(item.env).length ? { env: item.env } : {}) };
      files.push({ path: mcpPath, content: JSON.stringify(mcp, null, 2) + '\n' });
    }
  } else if (software === 'codex' && (mcps.length || fs.existsSync(path.join(projectRoot, '.codex', 'config.toml')))) {
    const tomlPath = path.join(projectRoot, '.codex', 'config.toml');
    const existing = fs.existsSync(tomlPath) ? fs.readFileSync(tomlPath, 'utf8') : '';
    const lines = mcps.flatMap(item => [`[mcp_servers.${tomlString(item.name)}]`, `command = ${tomlString(item.command)}`, `args = [${(item.args || []).map(tomlString).join(', ')}]`, ...Object.entries(item.env || {}).map(([k,v]) => `env.${tomlString(k)} = ${tomlString(v)}`), '']);
    files.push({ path: tomlPath, content: managedTomlBlock(existing, lines.join('\n')) });
  }
  let managedHooks = {};
  if (hooks.length || Object.keys(previous.hooks || {}).length) {
    const additions = {};
    for (const hook of hooks) {
      validateHook(hook);
      const directory = path.join(projectRoot, software === 'claude' ? '.claude' : '.codex', 'hooks', 'asset-manager', hook.id);
      const marker = path.join(directory, '.agent-asset-id');
      assertHookDestination(projectRoot, marker);
      if (fs.existsSync(directory) && (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== hook.id)) throw new Error('目标已有非本助手管理的 Hook 脚本目录');
      for (const [name, content] of Object.entries(hook.files)) {
        const target = path.join(directory, name);
        assertHookDestination(projectRoot, target);
        if (fs.existsSync(target) && !fs.statSync(target).isFile()) throw new Error('Hook 脚本目标不是普通文件');
        files.push({ path: target, content });
      }
      files.push({ path: marker, content: hook.id + '\n' });
      (additions[hook.event] ||= []).push(hookGroup(hook, directory));
    }
    const configPath = path.join(projectRoot, software === 'claude' ? '.claude/settings.json' : '.codex/hooks.json');
    assertHookDestination(projectRoot, configPath);
    const planned = files.find(file => file.path === configPath);
    let config = {};
    try { config = JSON.parse(planned?.content || (fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '{}')); } catch { throw new Error('现有 Hook 配置不是有效 JSON，已停止生效'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('现有 Hook 配置必须是 JSON 对象');
    const merged = mergeHookGroups(config.hooks || {}, previous.hooks, additions);
    config.hooks = merged.hooks;
    managedHooks = merged.owned;
    if (planned) planned.content = JSON.stringify(config, null, 2) + '\n';
    else files.push({ path: configPath, content: JSON.stringify(config, null, 2) + '\n' });
  }
  // Shared configuration files must remain even after all managed hooks are removed.
  for (const shared of [path.join(projectRoot, '.codex/hooks.json'), path.join(projectRoot, '.claude/settings.json')]) {
    if ((previous.files || []).includes(shared) && !files.some(file => file.path === shared) && fs.existsSync(shared)) files.push({ path: shared, content: fs.readFileSync(shared, 'utf8') });
  }
  const currentPaths = files.map(x => x.path);
  const managedRuleRoot = path.join(projectRoot, '.claude', 'rules', 'asset-manager') + path.sep;
  const ruleFiles = Object.fromEntries(files.filter(file => file.path.startsWith(managedRuleRoot)).map(file => [file.path, crypto.createHash('sha256').update(file.content).digest('hex')]));
  const managedHookRoot = path.join(projectRoot, software === 'claude' ? '.claude' : '.codex', 'hooks', 'asset-manager') + path.sep;
  const hookFiles = Object.fromEntries(files.filter(file => file.path.startsWith(managedHookRoot)).map(file => [file.path, crypto.createHash('sha256').update(file.content).digest('hex')]));
  const removals = (previous.files || []).filter(x => !currentPaths.includes(x));
  for (const file of removals) {
    const rel = path.relative(projectRoot, path.resolve(file));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('生效记录包含项目目录外的路径');
    if (file.startsWith(managedHookRoot)) assertHookDestination(projectRoot, file);
    if (file.startsWith(managedRuleRoot)) assertHookDestination(projectRoot, file);
  }
  const assetRefs = [...(agent ? [['agent',agent.id]] : []), ...suiteIds.map(id=>['workflow',id]), ...[...selected.keys()].map(id=>['skill',id]), ...prompt.layers.map(layer=>['prompt',layer.id]), ...hookIds.map(id=>['hook',id]), ...hookGroupIds.map(id=>['hookgroup',id]), ...ruleIds.map(id=>['rule',id])];
  const assetSnapshots = assetRefs.map(([type,id])=>{const asset=get(type,id);return {type,id,title:titleFor(type,asset),version:asset.activeVersion || history(type,id)[0]?.hash || '',updatedAt:asset.updatedAt};});
  files.push({ path: manifestPath, content: JSON.stringify({ files: currentPaths, fileHashes: Object.fromEntries(files.map(file=>[file.path,crypto.createHash('sha256').update(file.content).digest('hex')])), agentId:agent?.id || null, modelId, assetSnapshots, tools: software === 'claude' ? (agent?.tools || []) : [], mcps: mcps.map(x => x.name), suiteIds, skillIds: [...selected.keys()], hookIds, directHookIds, hookGroupIds, hooks: managedHooks, hookFiles, ruleIds, ruleFiles, promptIds: prompt.layers.map(layer => layer.id), updatedAt: now() }, null, 2) + '\n' });
  return { project: project.title, software, files, removals, promptLayers: prompt.layers };
}
async function callModel(modelId, system, user) {
  const model = get('model', modelId);
  if (!model) throw new Error('模型配置不存在');
  const key = readJson(keysFile, {})[modelId];
  if (!key) throw new Error('请先保存 API Key');
  const url = new URL(model.baseUrl);
  const basePath = url.pathname.replace(/\/$/, '');
  const endpoint = basePath.endsWith('/v1/messages') ? url.href : new URL(`${basePath.endsWith('/v1') ? 'messages' : 'v1/messages'}`, url.href.endsWith('/') ? url.href : url.href + '/').href;
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: model.model, max_tokens: 3000, system, messages: [{ role: 'user', content: user }] }), signal: AbortSignal.timeout(90000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`模型服务返回 ${response.status}：${body.error?.message || JSON.stringify(body).slice(0, 250)}`);
  return (body.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
}
const defaultReview = '你是 Agent Skills 审查员。依据 Agent Skills 规范审查发现性、触发准确性、执行步骤、资源按需加载、验证方法和边界情况。指出具体问题、风险级别与可执行修改建议。不要虚构不存在的文件。';
const defaultImprove = '你是 Agent Skills 编辑员。根据用户遇到的问题修复 Skill。只返回 JSON 对象，格式为 {"summary":"修改说明","frontmatter":{...},"body":"完整 Markdown 正文"}。保留原有意图，并确保 name 和 description 符合 Agent Skills 规范。';
function projectConfiguration(projectId) {
  const project=assertProject(projectId), projectRoot=project.directory;
  const result={projectId, directory:projectRoot, deployments:[], externalRules:[]};
  const managedFiles=new Set();
  for(const software of ['claude','codex']) {
    const manifestPath=path.join(projectRoot,'.agent-asset-manager',`${software}.json`);
    try {
      let manifest={};
      if(fs.existsSync(manifestPath)) {
        assertHookDestination(projectRoot,manifestPath);
        manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
        if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)) throw Error('生效记录格式无效');
      }
      const legacy=manifest.updatedAt&&!manifest.assetSnapshots;
      const refs=manifest.assetSnapshots || [...(manifest.agentId?[{type:'agent',id:manifest.agentId}]:[]), ...[['workflow','suiteIds'],['skill','skillIds'],['prompt','promptIds'],['hook','hookIds'],['hookgroup','hookGroupIds'],['rule','ruleIds']].flatMap(([type,key])=>(manifest[key]||[]).map(id=>({type,id})))];
      const assets=refs.map(ref=>{
        const current=rawGet(ref.type,ref.id);
        return {...ref,title:ref.title||current?.title||'已删除资产',version:ref.version||null,deleted:!current,hasNewVersion:!!(current&&ref.updatedAt&&current.updatedAt!==ref.updatedAt)};
      });
      const files=(manifest.files||[]).map(file=>{
        assertHookDestination(projectRoot,file);
        managedFiles.add(path.resolve(file));
        const exists=fs.existsSync(file), hash=manifest.fileHashes?.[file]||manifest.ruleFiles?.[file]||manifest.hookFiles?.[file];
        return {path:path.relative(projectRoot,file).replaceAll('\\','/'),status:!exists?'missing':!fs.statSync(file).isFile()?'invalid':hash&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash?'modified':hash?'unchanged':'unverified'};
      });
      const model=manifest.modelId?rawGet('model',manifest.modelId):null;
      result.deployments.push({software,applied:!!manifest.updatedAt,updatedAt:manifest.updatedAt||null,legacy:!!legacy,modelTitle:model?.title||'',assets,files,tools:manifest.tools||[],mcps:manifest.mcps||[]});
    } catch(error) {result.deployments.push({software,error:error.message});}
  }
  const ruleRoot=path.join(projectRoot,'.claude','rules');
  const walk=(directory,depth=0)=>{
    if(depth>15||result.externalRules.length>=500||!fs.existsSync(directory)||fs.lstatSync(directory).isSymbolicLink())return;
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory())walk(file,depth+1);
      else if(entry.isFile()&&entry.name.endsWith('.md')&&!managedFiles.has(path.resolve(file))&&result.externalRules.length<500) result.externalRules.push({path:path.relative(projectRoot,file).replaceAll('\\','/')});
    }
  };
  // Inspect only project-local rules; never follow directory junctions.
  try {assertHookDestination(projectRoot,ruleRoot);walk(ruleRoot);}catch(error){result.externalRulesError=error.message;}
  return result;
}
function settings() { return list('settings')[0] || { id: null, title: '审查与改进提示词', reviewSystem: defaultReview, improveSystem: defaultImprove }; }
function discoveryKey(project,key) {
  return crypto.createHash('sha256').update(JSON.stringify([project.id,project.directory,key])).digest('hex');
}
function discoverProject(project,includeSkipped=false) {
  const scan=scanProjectAssets(project.directory,project.id,parseImportedSkill,validateAsset);
  const records=readJson(importsFile,{});
  let imported=0,skipped=0;
  scan.candidates=scan.candidates.filter(item=>{
    const record=records[discoveryKey(project,item.key)];
    if(record?.fingerprint===item.fingerprint){
      if(record.decision==='imported'&&rawGet(record.type,record.assetId)){imported++;return false;}
      if(record.decision==='skipped'){skipped++;item.decision='skipped';return includeSkipped;}
    }
    return true;
  });
  return {...scan,imported,skipped};
}
async function handleApi(req, url) {
  const segments = url.pathname.slice(5).split('/').filter(Boolean);
  const method = req.method;
  const body = ['POST', 'PUT', 'DELETE'].includes(method) ? await readBody(req) : {};
  if (segments[0] === 'plugins') {
    const [,id,action]=segments;
    if(method==='GET'&&!id)return plugins.list();
    if(method==='POST'&&!id)return plugins.create(body);
    if(action==='assets'&&method==='GET') {
      const directory=plugins.directory(id);
      const scan=scanProjectAssets(directory,id,parseImportedSkill,validateAsset,{plugin:true});
      const detail=await plugins.action(id,'detail');
      for(const file of detail.files.filter(f=>/^\.plugin-assets\/[^/]+\/[^/]+\.json$/.test(f.path))){
        try{const asset=JSON.parse(fs.readFileSync(path.join(directory,file.path),'utf8'));const type=file.path.split('/')[1];safeType(type);scan.candidates.push({key:file.path,source:file.path,type,title:titleFor(type,asset),asset,importable:true});}catch(error){scan.warnings.push(file.path+'：'+error.message);}
      }
      return scan;
    }
    if(action==='add-asset'&&method==='POST') {
      const asset=rawGet(safeType(body.type),safeId(body.assetId));if(!asset)throw Error('资产不存在');
      if(['settings','project'].includes(body.type))throw Error('项目与审查配置不作为包内资产');
      const clean=structuredClone(asset);delete clean.apiKey;delete clean.directory;
      return plugins.action(id,'save',{message:body.message,files:[{path:`.plugin-assets/${body.type}/${asset.id}.json`,content:JSON.stringify(clean,null,2)}]});
    }
    if(method==='GET'&&(!action||['detail','file','diff','upstream-diff'].includes(action)))return plugins.action(id,action||'detail',Object.fromEntries(url.searchParams));
    if(method==='POST')return plugins.action(id,action,body);
    throw Error('无效 Plugin 请求');
  }
  if (segments[0] === 'project-discovery' && method === 'GET') {
    const project=assertProject(url.searchParams.get('projectId'));
    return discoverProject(project,url.searchParams.get('includeSkipped')==='true');
  }
  if (segments[0] === 'project-import' && method === 'POST') {
    const project=assertProject(body.projectId);
    const scan=discoverProject(project,true);
    const item=scan.candidates.find(candidate=>candidate.key===body.key);
    if(!item||item.fingerprint!==body.fingerprint)throw Error('来源内容已变化，请重新识别后确认');
    if(item.decision==='imported')throw Error('此项已经导入，请勿重复确认');
    if(!['import','skip'].includes(body.action))throw Error('请选择导入或跳过');
    const records=readJson(importsFile,{}),key=discoveryKey(project,item.key);
    let asset;
    if(body.action==='import'){
      if(!item.importable)throw Error(item.error||'此项无法导入');
      const draft={...item.asset};
      if(body.title!==undefined)draft.title=String(body.title).trim();
      if(list(item.type).some(existing=>existing.title.trim()===draft.title.trim()))throw Error('资产库已有同类型的同名资产，请查看差异后修改名称，或跳过这一项');
      if(body.modelId&&profiledTypes.has(item.type)){draft.assetHarness=item.harness;draft.assetModelId=body.modelId;}
      asset=save(item.type,draft,body.message);
    }
    records[key]={fingerprint:item.fingerprint,decision:body.action==='import'?'imported':'skipped',assetId:asset?.id,type:item.type,updatedAt:now()};
    writeJson(importsFile,records);
    return {ok:true,asset};
  }
  if (segments[0] === 'bootstrap' && method === 'GET') return { hookEvents, assets: Object.fromEntries([...types].map(t => [t, list(t).map(a => t === 'model' ? { ...a, hasKey: !!readJson(keysFile, {})[a.id] } : a)])), settings: settings(), sync: { ...syncStatus(), conflicts: conflictItems() } };
  if (segments[0] === 'rule-validate' && method === 'POST') return {ok:true,markdown:renderRule(body.asset)};
  if (segments[0] === 'import-hooks' && method === 'POST') return parseHookConfiguration(body.content,body.harness,body.fileName);
  if (segments[0] === 'import-rule' && method === 'POST') return parseRule(body.content,body.fileName);
  if (segments[0] === 'project-configuration' && method === 'GET') return projectConfiguration(url.searchParams.get('projectId'));
  if (segments[0] === 'hook-test' && method === 'POST') return testHook(body.asset, body.input, body.projectId ? assertProject(body.projectId).directory : undefined);
  if (segments[0] === 'deployment-hooks' && method === 'GET') {
    const project = assertProject(url.searchParams.get('projectId'));
    const software = url.searchParams.get('software');
    if (!['claude','codex'].includes(software)) throw new Error('目标软件无效');
    const manifest = readJson(path.join(project.directory, '.agent-asset-manager', `${software}.json`), {});
    return { hookIds: manifest.directHookIds ?? manifest.hookIds ?? [], hookGroupIds:manifest.hookGroupIds||[], applied: Object.keys(manifest.hooks || {}).length > 0, ruleIds:manifest.ruleIds||[], rulesApplied:!!manifest.ruleIds?.length };
  }
  if (segments[0] === 'hook-validate' && method === 'POST') { validateHook(body.asset); return { ok: true, config: { hooks: { [body.asset.event]: [hookGroup(body.asset, path.join(root, '.example-hook'))] } } }; }
  if (segments[0] === 'sync') {
    if (method === 'GET' && segments[1] === 'status') return { ...syncStatus(), conflicts: conflictItems() };
    if (method === 'POST' && segments[1] === 'connect') return connectRemote(body.url);
    if (method === 'POST' && segments[1] === 'run') return syncRemote();
    if (method === 'POST' && segments[1] === 'resolve') return resolveConflicts(body.choices);
  }
  if (segments[0] === 'pick-directory' && method === 'POST') return chooseProjectDirectory(body.initial);
  if (segments[0] === 'recent' && method === 'GET') return recentVersions();
  if (segments[0] === 'trash' && method === 'GET') return trash(url.searchParams.get('type'));
  if (segments[0] === 'validate' && method === 'POST') return { issues: validateSkill(body.variant, body.software), markdown: body.variant ? renderSkill(body.variant, body.software) : '' };
  if (segments[0] === 'import-skill' && method === 'POST') return parseImportedSkill(body.skillMd);
  if (segments[0] === 'compose' && method === 'POST') return composedPrompt(body);
  if (segments[0] === 'deploy' && method === 'POST') {
    const plan = makeDeployment(body);
    if (body.preview) return { project: plan.project, software: plan.software, files: plan.files.map(x => ({ path: x.path, content: Buffer.isBuffer(x.content) ? `[二进制文件 · ${x.content.length} 字节]` : x.content, ...(x.writeMode ? {writeMode:x.writeMode} : {}) })), removals: plan.removals, promptLayers: plan.promptLayers };
    for (const file of plan.removals) if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      fs.unlinkSync(file);
      let parent = path.dirname(file);
      const boundary = path.dirname(path.dirname(file));
      while (parent !== boundary && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) { fs.rmdirSync(parent); parent = path.dirname(parent); }
    }
    for (const file of plan.files) { fs.mkdirSync(path.dirname(file.path), { recursive: true }); fs.writeFileSync(file.path, file.content, 'utf8'); }
    return { ok: true, files: plan.files.map(x => x.path) };
  }
  if (segments[0] === 'ai' && method === 'POST') {
    const skill = get('skill', body.skillId);
    if (!skill) throw new Error('Skill 不存在');
    const variant = getVariant(skill, body.software || 'common');
    const content = renderSkill(variant, body.software || 'common');
    const config = settings();
    if (segments[1] === 'review') return { text: await callModel(body.modelId, config.reviewSystem || defaultReview, `请审查以下 Skill。\n\n${content}\n\n资源文件：${Object.keys(skill.files || {}).join(', ') || '无'}`) };
    if (segments[1] === 'improve') {
      if (!String(body.problem || '').trim()) throw new Error('请描述遇到的问题');
      const text = await callModel(body.modelId, config.improveSystem || defaultImprove, `遇到的问题：${body.problem}\n\n当前 Skill：\n${content}\n\n资源文件：${Object.keys(skill.files || {}).join(', ') || '无'}`);
      let proposal = null;
      try { proposal = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch {}
      return { text, proposal };
    }
  }
  const [type, id, action] = segments;
  safeType(type);
  if (method === 'GET' && !id) return list(type);
  if (method === 'GET' && id && !action) { const item = get(type, id); if (!item) throw new Error('资产不存在'); return type === 'model' ? { ...item, hasKey: !!readJson(keysFile, {})[id] } : item; }
  if (method === 'POST' && !id) return save(type, body.asset, body.message);
  if (method === 'DELETE' && id) return remove(type, id, body.message);
  if (method === 'GET' && action === 'history') return history(type, id);
  if (method === 'GET' && action === 'diff') return { diff: diff(type, id, url.searchParams.get('hash')) };
  if (method === 'POST' && action === 'select-version') return selectVersion(type, id, body.hash || null);
  if (method === 'POST' && type === 'project' && action === 'local-path') return setProjectPath(id, body.directory || '');
  if (method === 'POST' && action === 'restore') return restore(type, id, body.hash, body.message);
  throw new Error('无效请求');
}
function readBody(req) { return new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; if (raw.length > 20_000_000) { reject(new Error('请求内容过大')); req.destroy(); } });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON 格式无效')); } });
  req.on('error', reject);
}); }
function send(res, status, data, type = 'application/json; charset=utf-8') {
  const content = type.startsWith('application/json') ? JSON.stringify(data) : data;
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(content);
}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
ensureData();
http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    const allowedHosts = ['localhost', '127.0.0.1', ...localAddresses()].map(address => `${address}:${port}`);
    if (!allowedHosts.includes(host)) return send(res, 403, { error: '请使用本机或局域网 IP 地址访问' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) return send(res, 403, { error: '不允许跨站请求' });
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) return send(res, 200, await handleApi(req, url));
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!/^[\w.\/-]+$/.test(name) || name.split('/').includes('..')) return send(res, 404, { error: '页面不存在' });
    const file = path.join(root, 'public', name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: '页面不存在' });
    return send(res, 200, fs.readFileSync(file), mime[path.extname(file)] || 'application/octet-stream');
  } catch (error) { send(res, 400, { error: error.message || '请求失败' }); }
}).listen(port, '0.0.0.0', () => {
  console.log(`Agent 资产管理助手：http://127.0.0.1:${port}`);
  for (const address of localAddresses().filter(address => !address.startsWith('127.'))) {
    console.log(`局域网访问：http://${address}:${port}`);
  }
});
