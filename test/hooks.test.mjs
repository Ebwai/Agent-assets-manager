import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { validateHook, testHook, mergeHookGroups } from '../hooks.mjs';

const hook = (harness='claude') => ({title:'命令检查',description:'检查命令',harness,event:'PreToolUse',matcher:'Bash',async:false,timeout:3,runtime:'node',entry:'scripts/main.mjs',files:{'scripts/main.mjs':`import fs from 'node:fs'; const input=JSON.parse(fs.readFileSync(0,'utf8')); if(input.tool_input.command==='unsafe') {console.error('Blocked');process.exit(2);} console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',additionalContext:'checked'}}));`}});
test('模拟运行区分匹配、拒绝、异步、错误和超时',async()=>{
  const a=hook(), input={hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command:'unsafe'}};
  assert.equal((await testHook(a,input)).blocked,true);
  assert.equal((await testHook({...a,async:true},input)).blocked,false);
  assert.equal((await testHook(a,{...input,tool_name:'Read'})).matched,false);
  const allowed=await testHook(a,{...input,tool_input:{command:'safe'}});
  assert.equal(allowed.output.hookSpecificOutput.additionalContext,'checked');
  assert.equal(allowed.exitCode,0);
  const exitsTwo={...a,event:'SessionStart',matcher:'',files:{'scripts/main.mjs':'process.exit(2);'}};
  assert.equal((await testHook(exitsTwo,{hook_event_name:'SessionStart'})).blocked,false);
  assert.equal((await testHook({...exitsTwo,event:'PermissionRequest'},{hook_event_name:'PermissionRequest'})).blocked,false);
  assert.equal((await testHook({...a,timeout:1,files:{'scripts/main.mjs':'setInterval(()=>{},1000);'}},input)).timedOut,true);
  assert.throws(()=>validateHook({...a,entry:'scripts/../outside.mjs'}),/安全相对路径/);
  assert.throws(()=>validateHook({...a,harness:'codex',event:'SessionEnd',matcher:'',async:true}),/只能同步/);
  assert.throws(()=>validateHook({...a,event:'Stop',matcher:'Bash'}),/不支持匹配/);
});

test('保留外部 hooks，并检测管理条目的项目内修改',()=>{
  const owned={hooks:[{command:'owned',timeout:3}]},external={hooks:[{command:'external'}]};
  const merged=mergeHookGroups({PreToolUse:[external,owned]},{PreToolUse:[owned]},{PreToolUse:[owned]});
  assert.equal(merged.hooks.PreToolUse.length,2);
  assert.deepEqual(mergeHookGroups(merged.hooks,merged.owned,{}).hooks,{PreToolUse:[external]});
  assert.throws(()=>mergeHookGroups({PreToolUse:[{hooks:[{command:'owned',timeout:4}]}]},{PreToolUse:[owned]},{}),/已在项目中修改/);
});

test('Hook 资产版本与双软件生效：不绑定模型，重复生效和撤销保留外部配置',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hook-deploy-test-'));
  const projectDir=path.join(temp,'project with space'); fs.mkdirSync(projectDir);
  const port=45000+Math.floor(Math.random()*10000);
  const server=spawn(process.execPath,['server.mjs'],{cwd:path.resolve('.'),env:{...process.env,ASSET_DATA_DIR:path.join(temp,'data'),PORT:String(port)},stdio:'pipe'});
  t.after(()=>{server.kill();fs.rmSync(temp,{recursive:true,force:true});});
  const request=async(url,method='GET',body)=>{const res=await fetch(`http://127.0.0.1:${port}/api/${url}`,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await res.json();if(!res.ok)throw Error(result.error);return result;};
  let ready=false;for(let i=0;i<80;i++){try{await request('bootstrap');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
  const project=await request('project','POST',{asset:{title:'测试项目',directory:projectDir},message:'登记测试项目'});
  const model=await request('model','POST',{asset:{title:'测试模型',model:'test',baseUrl:'https://api.anthropic.com'},message:'登记测试模型'});
  for(const harness of ['claude','codex']) {
    const a=await request('hook','POST',{asset:hook(harness),message:'添加命令检查'});
    await request('hook','POST',{asset:{...a,description:'新版说明'},message:'更新用途说明'});
    assert.equal((await request(`hook/${a.id}/history`)).length,2);
    const configPath=path.join(projectDir,harness==='claude'?'.claude/settings.json':'.codex/hooks.json');
    fs.mkdirSync(path.dirname(configPath),{recursive:true});
    const external={hooks:[{type:'command',command:'echo external'}]};
    fs.writeFileSync(configPath,JSON.stringify({custom:'retain',hooks:{PreToolUse:[external]}}));
    const body={projectId:project.id,software:harness,hookIds:[a.id],promptIds:[]};
    const preview=await request('deploy','POST',{...body,preview:true});
    assert.equal(JSON.parse(fs.readFileSync(configPath)).hooks.PreToolUse.length,1,'preview has no side effects');
    assert.ok(preview.files.some(f=>f.path.endsWith('main.mjs')));
    const agent=await request('agent','POST',{asset:{title:'关联 Hook 的 Agent',assetHarness:harness,assetModelId:model.id,harness,modelId:model.id,instructions:'检查项目',skillIds:[],workflowIds:[],promptIds:[],hookIds:[a.id],tools:[],mcps:[]},message:'关联命令检查'});
    const agentPreview=await request('deploy','POST',{projectId:project.id,software:harness,modelId:model.id,agentId:agent.id,hookIds:[],promptIds:[],preview:true});
    assert.ok(agentPreview.files.some(f=>f.path.endsWith('main.mjs')),'Agent association deploys the hook');
    await request('deploy','POST',body);await request('deploy','POST',body);
    assert.equal(JSON.parse(fs.readFileSync(configPath)).hooks.PreToolUse.length,2);
    const scriptFile=preview.files.find(f=>f.path.endsWith('main.mjs')).path;
    const command=JSON.parse(fs.readFileSync(configPath)).hooks.PreToolUse[1].hooks[0].command;
    const execution=process.platform==='win32'
      ? spawnSync('powershell.exe',['-NoProfile','-EncodedCommand',command.split(' ').at(-1)],{input:JSON.stringify({tool_input:{command:'unsafe'}}),encoding:'utf8',timeout:10000,windowsHide:true})
      : spawnSync('/bin/sh',['-c',command],{input:JSON.stringify({tool_input:{command:'unsafe'}}),encoding:'utf8',timeout:10000});
    assert.equal(execution.status,2,execution.stderr);
    const scriptContent=fs.readFileSync(scriptFile,'utf8');
    fs.writeFileSync(scriptFile,scriptContent+'\n// edited in project');
    await assert.rejects(request('deploy','POST',body),/Hook 文件已在项目中修改/);
    fs.writeFileSync(scriptFile,scriptContent);
    const status=await request(`deployment-hooks?projectId=${project.id}&software=${harness}`);assert.equal(status.applied,true);
    await request('deploy','POST',{...body,hookIds:[]});
    assert.equal(fs.existsSync(scriptFile),false);
    const config=JSON.parse(fs.readFileSync(configPath));assert.deepEqual(config.hooks.PreToolUse,[external]);assert.equal(config.custom,'retain');
    await request('deploy','POST',body);
    fs.writeFileSync(configPath,'broken JSON');
    await assert.rejects(request('deploy','POST',body),/有效 JSON/);
    assert.equal(fs.readFileSync(configPath,'utf8'),'broken JSON');
    await assert.rejects(request('deploy','POST',{...body,software:harness==='claude'?'codex':'claude'}),/不适用于目标软件/);
  }
});
