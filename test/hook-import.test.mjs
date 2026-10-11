import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHookConfiguration} from '../hook-import.mjs';
import {hookGroup} from '../hooks.mjs';

test('原生 Hook JSON：多事件、多分组、BOM、未知类型逐项保留，解析不执行',()=>{
  const command='node -e "throw Error(\'DO NOT EXECUTE\')"';
  const input={permissions:{allow:['Read']},hooks:{PreToolUse:[{matcher:'Bash',hooks:[{type:'command',command,timeout:5},{type:'command',command:'echo second',async:true}]}],Stop:[{hooks:[{type:'prompt',prompt:'check'}]},{hooks:[{type:'command',command:'echo stop',futureField:true}]}],UserPromptSubmit:[{hooks:[{type:'command',command:'echo prompt'}]}]}};
  const result=parseHookConfiguration('\uFEFF'+JSON.stringify(input),'claude','settings.local.json');
  assert.equal(result.candidates.length,5);assert.equal(result.candidates.filter(c=>c.importable).length,3);
  const first=result.candidates[0];assert.equal(first.asset.matcher,'Bash');assert.equal(first.asset.timeout,5);
  assert.ok(first.asset.files['scripts/main.mjs'].includes('DO NOT EXECUTE'));
  assert.equal(result.candidates[1].asset.async,true);assert.equal(result.candidates[1].asset.timeout,600);
  assert.equal(result.candidates[4].asset.timeout,30);
  assert.equal(result.candidates[2].raw.handler.prompt,'check');assert.match(result.candidates[3].error,/futureField/);
  assert.throws(()=>parseHookConfiguration('{','claude'),/解析失败/);
  assert.throws(()=>parseHookConfiguration('{}','claude'),/hooks 对象/);
  assert.throws(()=>parseHookConfiguration(JSON.stringify(input),'invalid'),/请选择/);
  assert.throws(()=>parseHookConfiguration('x'.repeat(512001),'claude'),/500 KB/);
});

test('Codex JSON / TOML 等价，保留 Windows 命令与原生参数，特殊事件默认超时',()=>{
  const input={description:'example',hooks:{SessionEnd:[{hooks:[{type:'command',command:'echo done'}]}],PreToolUse:[{matcher:'Bash',hooks:[{type:'command',command:'echo unix',commandWindows:'echo windows',statusMessage:'Checking',additionalContextLimit:5000}]}]}};
  const json=parseHookConfiguration(JSON.stringify(input),'codex');
  const toml=parseHookConfiguration('model = "example"\n[[hooks.SessionEnd]]\n[[hooks.SessionEnd.hooks]]\ntype = "command"\ncommand = "echo done"\n[[hooks.PreToolUse]]\nmatcher = "Bash"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "echo unix"\ncommand_windows = "echo windows"\nstatus_message = "Checking"\nadditional_context_limit = 5000\n','codex','config.toml');
  assert.deepEqual(json.candidates.map(c=>c.asset),toml.candidates.map(c=>c.asset));
  assert.equal(json.candidates[0].asset.timeout,1);
  const asset=json.candidates[1].asset;assert.equal(asset.timeout,600);assert.ok(asset.files['scripts/main.mjs'].includes("process.platform === 'win32'"));
  const generated=hookGroup(asset,'/tmp/hook').hooks[0];assert.equal(generated.statusMessage,'Checking');assert.equal(generated.additionalContextLimit,5000);
  const malformed=parseHookConfiguration(JSON.stringify({hooks:{Stop:{hooks:[]},PreToolUse:[{hooks:'bad'}],SessionEnd:[{hooks:[{type:'command',command:'echo',timeout:5}]}]}}),'codex');
  assert.equal(malformed.candidates.length,3);assert.ok(malformed.candidates.every(c=>!c.importable));
});
