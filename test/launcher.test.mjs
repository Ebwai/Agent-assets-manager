import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { desktopEntry, launch } from '../scripts/launch.mjs';

test('Linux 快捷方式保留空格与中文路径，转义字段代码和命令字符，不注入 shell', () => {
  const entry = desktopEntry('/home/test/有 空格 % "$`');
  assert.match(entry, /Terminal=true/); assert.match(entry, /Exec=\/bin\/bash "/);
  assert.ok(entry.includes('有 空格 %% ')); assert.ok(entry.includes('\\\\"')); assert.ok(entry.includes('\\\\$'));
  assert.ok(desktopEntry('/tmp/a' + String.fromCharCode(92) + 'b').includes(String.fromCharCode(92).repeat(4)));
  assert.ok(!entry.includes('sh -c')); assert.throws(() => desktopEntry('/tmp/line\nname'), /换行/);
});

test('共享启动流程：端口冲突不打开浏览器；就绪后打开页面，停止时关闭子服务', { timeout: 20000 }, async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-launcher-'));
  const keys = ['PORT', 'ASSET_DATA_DIR', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.ok(path.resolve(data).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(data, { recursive: true, force: true });
  });
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  process.env.PORT = String(port); process.env.ASSET_DATA_DIR = data; process.env.CODEX_HOME = path.join(data, 'codex'); process.env.CLAUDE_CONFIG_DIR = path.join(data, 'claude');
  await assert.rejects(launch({ openBrowser: () => assert.fail('端口冲突时不能打开浏览器') }), /端口.*占用/);
  await new Promise(resolve => probe.close(resolve));
  let opened = 0, expectedPage = false;
  await launch({ openBrowser: async url => {
    opened++; expectedPage = (await (await fetch(url)).text()).includes('Agent 资产管理助手');
    process.emit('SIGINT');
  } });
  assert.equal(opened, 1); assert.equal(expectedPage, true);
  await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }));
});
