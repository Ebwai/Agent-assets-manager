import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createModelApplication } from '../model-application.mjs';

function run(command, args, env, cwd, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('原生客户端验收超时：' + path.basename(command) + ' ' + args[0] + '\\n' + stderr.slice(-1800) + '\\n' + stdout.slice(-1800))); }, 45000);
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    child.stdin.end(input || '');
  });
}

async function listAppServerModels(command, env, cwd) {
  const child = spawn(command, ['app-server', '--listen', 'stdio://'], { env, cwd, windowsHide: true });
  const exited = once(child, 'close');
  let buffer = '';
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('app-server model/list 超时')), 15000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.stderr.resume();
      child.stdout.on('data', data => {
        buffer += data;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          let message; try { message = JSON.parse(line); } catch { continue; }
          if (message.id === 1) {
            if (message.error) { clearTimeout(timer); reject(new Error(JSON.stringify(message.error))); return; }
            child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
            child.stdin.write(JSON.stringify({ id: 2, method: 'model/list', params: { includeHidden: false } }) + '\n');
          }
          if (message.id === 2) { clearTimeout(timer); if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result); }
        }
      });
      child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'mapping_acceptance', version: '1.0' }, capabilities: { experimentalApi: true } } }) + '\n');
    });
  } finally { child.kill(); await exited; }
}

test('原生客户端验收：Codex 列表和实际请求、Claude 家族别名实际请求均使用映射 ID', { timeout: 120000 }, async t => {
  if (process.env.RUN_NATIVE_MODEL_TESTS !== '1') { t.skip('设置 RUN_NATIVE_MODEL_TESTS=1 执行已安装客户端验收'); return; }
  const codex = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const claude = process.env.CLAUDE_TEST_BINARY || 'claude';
  assert.equal(spawnSync(codex, ['--version'], { windowsHide: true }).status, 0);
  assert.equal(spawnSync(claude, ['--version'], { windowsHide: true }).status, 0);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-mapping-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    // A Windows client may retain its working directory handle briefly after exit.
    for (const name of fs.readdirSync(root)) fs.rmSync(path.join(root, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    try { fs.rmdirSync(root); } catch (error) { if (error.code !== 'EBUSY' || fs.readdirSync(root).length) throw error; t.diagnostic('Windows 客户端暂时占用空的验收目录；配置与凭据已清理。'); }
  });
  const requests = [];
  t.after(() => t.diagnostic(JSON.stringify(requests)));
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : {};
    if (req.url.includes('/messages') && !req.url.includes('count_tokens')) {
      requests.push({ api: 'claude', model: data.model });
      const message = { id: 'msg_test', type: 'message', role: 'assistant', model: data.model, content: [{ type: 'text', text: 'MAPPING_OK' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 3 } };
      if (!data.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const events = [{ type: 'message_start', message: { ...message, content: [], stop_reason: null } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'MAPPING_OK' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } }, { type: 'message_stop' }];
      res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')); return;
    }
    if (req.url.endsWith('/responses')) {
      requests.push({ api: 'codex', model: data.model });
      const item = { id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'MAPPING_OK', annotations: [] }] };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const events = [{ type: 'response.created', response: { id: 'resp_test', status: 'in_progress', output: [] } }, { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } }, { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: 'MAPPING_OK' }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } }];
      res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')); return;
    }
    if (req.url.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":10}'); return; }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not found"}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const privateDir = path.join(root, 'private'), codexHome = path.join(root, 'codex'), claudeHome = path.join(root, 'claude'); fs.mkdirSync(privateDir);
  const keysFile = path.join(privateDir, 'keys.json'); fs.writeFileSync(keysFile, '{"test":"local-test-key"}');
  const app = createModelApplication({ privateDir, keysFile, codexHome, claudeHome });
  const service = { id: 'test', title: '测试映射', protocol: 'openai-responses', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, claudeBaseUrl: `http://127.0.0.1:${server.address().port}`, model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'] };
  const modelMapping = { claude: { opus: 'deepseek-v4-pro' } };
  for (const software of ['codex', 'claude']) { const input = { model: service, key: 'local-test-key', software, selectedModel: 'deepseek-flash', modelMapping }; app.apply(input, app.preview(input).token); }
  const env = { ...process.env, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome, DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'OPENAI_API_KEY']) delete env[key];
  const catalog = await run(codex, ['debug', 'models'], env, root);
  assert.equal(catalog.status, 0, catalog.stderr); assert.deepEqual(JSON.parse(catalog.stdout).models.map(row => row.slug), service.models);
  const listed = await listAppServerModels(codex, env, root);
  assert.deepEqual(listed.data.map(row => row.model), service.models);
  const inference = await run(codex, ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', 'Reply exactly MAPPING_OK. Do not use tools.'], env, root);
  assert.equal(inference.status, 0, inference.stderr); assert.match(inference.stdout, /MAPPING_OK/);
  for (const alias of ['sonnet', 'opus', 'haiku']) {
    const result = await run(claude, ['-p', '--model', alias, '--output-format', 'json', '--tools', '', '--max-turns', '1', 'Reply exactly MAPPING_OK.'], env, root);
    assert.equal(result.status, 0, result.stderr + result.stdout.slice(0, 1000)); assert.match(result.stdout, /MAPPING_OK/);
  }
  assert.ok(requests.some(row => row.api === 'codex' && row.model === 'deepseek-flash'));
  assert.ok(requests.some(row => row.api === 'claude' && row.model === 'deepseek-v4-pro'));
  assert.ok(requests.filter(row => row.api === 'claude' && row.model === 'deepseek-flash').length >= 2);
  assert.ok(requests.every(row => service.models.includes(row.model)), JSON.stringify(requests));
});
