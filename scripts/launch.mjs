import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function desktopEntry(directory) {
  // Desktop Exec has its own escaping rules, and percent signs are field codes.
  const script = path.posix.join(directory, '启动助手.sh');
  if (/[\r\n]/.test(script)) throw new Error('目录名包含换行，无法创建桌面快捷方式');
  const quoted = script.replaceAll('%', '%%').replace(/[\\"$`]/g, char => '\\'.repeat(char === '\\' ? 4 : 2) + (char === '\\' ? '' : char));
  return `[Desktop Entry]\nType=Application\nName=Agent 资产管理助手\nComment=启动本机资产工作台\nExec=/bin/bash "${quoted}"\nTerminal=true\nIcon=utilities-terminal\nCategories=Development;\nStartupNotify=false\n`;
}

function installShortcut() {
  if (process.platform !== 'linux') throw new Error('桌面快捷方式安装用于 Ubuntu/Linux；macOS 请双击启动助手.command');
  const detected = spawnSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' });
  const desktop = detected.status === 0 && detected.stdout.trim() ? detected.stdout.trim() : path.join(os.homedir(), 'Desktop');
  fs.mkdirSync(desktop, { recursive: true });
  const file = path.join(desktop, 'agent-asset-manager.desktop');
  fs.writeFileSync(file, desktopEntry(root), { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  console.log(`已创建桌面快捷方式：${file}\n如显示为文本文件，请在桌面右键选择“允许启动”。请保留项目目录原来的位置。`);
}

export async function launch({ openBrowser = url => {
  const opener = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  opener.on('error', () => console.log('请手动打开浏览器：' + url));
} } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('需要 Node.js 20+，请升级后重新启动。');
  if (process.argv.includes('--install-shortcut')) return installShortcut();
  if (spawnSync('git', ['--version'], { stdio: 'ignore' }).status !== 0) throw new Error('未找到 Git，请先安装 Git。');
  const require = createRequire(path.join(root, 'package.json'));
  const dependencies = Object.keys(require('./package.json').dependencies || {});
  let missing = false;
  for (const dependency of dependencies) { try { require.resolve(dependency); } catch { missing = true; } }
  if (missing) {
    console.log('首次启动：正在安装依赖…');
    const result = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('依赖安装失败，请确认 npm 已安装且网络可用，再重新启动。');
  }
  const port = Number(process.env.PORT || 8073);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 需为 1–65535 的端口号');
  const url = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error(`端口 ${port} 已被占用，请关闭已有助手或更换 PORT。`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'inherit' });
  let stopped = false;
  const interrupt = () => { stopped = true; server.kill('SIGTERM'); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const completion = new Promise((resolve, reject) => {
    server.once('error', error => { stopped = true; reject(error); });
    server.once('exit', (code, signal) => { stopped = true; resolve(signal ? 0 : code || 0); });
  });
  const openWhenReady = async () => {
    for (let attempt = 0; attempt < 150 && !stopped; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        const html = await response.text();
        if (response.ok && html.includes('Agent 资产管理助手') && !stopped) {
          await openBrowser(url);
          console.log(`助手已启动：${url}\n保持此终端开启；按 Ctrl+C 停止服务。`);
          return;
        }
      } catch { /* Wait for the local server, then open the browser once. */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!stopped) console.log(`浏览器未自动打开，请手动访问 ${url}`);
  };
  const opening = openWhenReady();
  try { const code = await completion; await opening; process.exitCode = code; }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch().catch(error => { console.error(error.message); process.exitCode = 1; });
}
