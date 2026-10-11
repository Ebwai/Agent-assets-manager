import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// The editor and server use the same event catalogue. No model binding is needed.
export const hookEvents = [
  ['SessionStart','会话开始或恢复','source'],
  ['UserPromptSubmit','用户提交提示词',''],
  ['PreToolUse','工具执行前','tool_name'],
  ['PermissionRequest','需要权限决定时','tool_name'],
  ['PostToolUse','工具执行后','tool_name'],
  ['PreCompact','上下文压缩前','trigger'],
  ['PostCompact','上下文压缩后','trigger'],
  ['SubagentStart','子 Agent 启动','agent_type'],
  ['SubagentStop','子 Agent 结束','agent_type'],
  ['Stop','一轮回答结束',''],
  ['SessionEnd','会话结束','reason'],
  ['Interrupt','用户中断当前轮','', 'codex'],
  ['PostToolUseFailure','工具执行失败','tool_name','claude'],
  ['Notification','收到通知','notification_type','claude'],
  ['StopFailure','回答因 API 错误结束','','claude'],
  ['InstructionsLoaded','项目指令加载','','claude'],
  ['ConfigChange','配置变化','source','claude'],
  ['WorktreeCreate','创建工作树','','claude'],
  ['WorktreeRemove','移除工作树','','claude'],
].map(([name,label,matchField,harness])=>({name,label,matchField,harness}));

export function validateHook(a) {
  if (!a || !['claude','codex'].includes(a.harness)) throw new Error('请选择 Hook 的目标软件');
  const event = hookEvents.find(e=>e.name===a.event && (!e.harness || e.harness===a.harness));
  if (!event) throw new Error('目标软件不支持此 Hook 事件');
  if (typeof a.matcher !== 'string' || a.matcher.length > 500) throw new Error('匹配条件无效或超过 500 字符');
  if (a.matcher && a.matcher!=='*') { try { new RegExp(a.matcher); } catch { throw new Error('匹配条件不是有效的正则表达式'); } }
  if (a.matcher && !event.matchField) throw new Error('此事件不支持匹配条件，请留空');
  if (typeof a.async !== 'boolean') throw new Error('请选择同步或异步运行');
  if (a.event==='SessionEnd' && a.async && a.harness==='codex') throw new Error('Codex 的会话结束 Hook 只能同步运行');
  if (!Number.isInteger(a.timeout) || a.timeout<1 || a.timeout>600) throw new Error('超时必须是 1–600 秒的整数');
  if (a.harness==='codex' && ['SessionEnd','Interrupt'].includes(a.event) && a.timeout>3) throw new Error('Codex 会话结束和中断 Hook 的超时最多为 3 秒');
  if (!['node','python','powershell','bash'].includes(a.runtime)) throw new Error('脚本运行环境无效');
  if(a.nativeOptions!==undefined){
    if(a.harness!=='codex'||!a.nativeOptions||typeof a.nativeOptions!=='object'||Array.isArray(a.nativeOptions)||Object.keys(a.nativeOptions).some(k=>!['statusMessage','additionalContextLimit'].includes(k)))throw Error('原生 Hook 附加配置无效');
    if(a.nativeOptions.statusMessage!==undefined&&typeof a.nativeOptions.statusMessage!=='string')throw Error('状态提示必须是字符串');
    if(a.nativeOptions.additionalContextLimit!==undefined&&(!Number.isInteger(a.nativeOptions.additionalContextLimit)||a.nativeOptions.additionalContextLimit<0))throw Error('上下文长度限制必须为非负整数');
  }
  if (!a.files || typeof a.files!=='object' || Array.isArray(a.files)) throw new Error('缺少脚本文件');
  let total=0;
  const fileNames=new Set();
  for (const [name,content] of Object.entries(a.files)) {
    safeHookPath(name);
    if(fileNames.has(name.toLowerCase())) throw new Error('Hook 文件名不能仅大小写不同');
    fileNames.add(name.toLowerCase());
    if (typeof content!=='string') throw new Error('Hook 资源只支持文本文件');
    total+=Buffer.byteLength(content);
  }
  if (total>1_000_000 || Object.keys(a.files).length>50) throw new Error('Hook 文件最多 50 个，总大小最多 1 MB');
  safeHookPath(a.entry);
  if (!Object.hasOwn(a.files,a.entry) || !a.files[a.entry].trim()) throw new Error('入口脚本不存在或内容为空');
  const extension={node:/\.[mc]?js$/,python:/\.py$/,powershell:/\.ps1$/,bash:/\.sh$/}[a.runtime];
  if (!extension.test(a.entry)) throw new Error('入口脚本后缀与运行环境不一致');
  return event;
}
export function safeHookPath(name) {
  if (typeof name!=='string' || !/^(scripts|references|assets)\/[A-Za-z0-9_./-]+$/.test(name) || name.split('/').some(p=>!p || p.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Hook 文件必须使用 scripts/、references/ 或 assets/ 下的安全相对路径');
  return name;
}
export function assertHookDestination(root, destination) {
  const relative=path.relative(root,destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Hook 目标必须位于项目内');
  let current=root;
  for(const part of relative.split(path.sep)) {
    current=path.join(current,part);
    if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink()) throw new Error('Hook 目标包含符号链接或目录联接，已停止生效');
  }
}
function invocation(a, script, windows=false, testing=false) {
  const runtime={node:testing?process.execPath:'node',python:windows?'python':'python3',powershell:windows?'powershell.exe':'pwsh',bash:'bash'}[a.runtime];
  return {command:runtime,args:[...(a.runtime==='powershell'?['-NoProfile','-File']:[]),script]};
}
function shellQuote(value,windows) {
  if (windows) return '"'+value.replaceAll('"','\\"')+'"';
  return "'"+value.replaceAll("'", "'\\''")+"'";
}
export function hookGroup(a, directory) {
  validateHook(a);
  const script=path.resolve(directory,a.entry);
  const windows=process.platform==='win32';
  const call=invocation(a,script,windows);
  const command=windows
    ? 'powershell.exe -NoProfile -EncodedCommand '+Buffer.from('& '+[call.command,...call.args].map(v=>"'"+v.replaceAll("'","''")+"'").join(' ')+'; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $?) { exit 1 }','utf16le').toString('base64')
    : [call.command,...call.args.map(v=>shellQuote(v,false))].join(' ');
  // Commands use absolute paths so starting the harness in a subfolder is safe.
  return { ...(a.matcher?{matcher:a.matcher}:{}), hooks:[{type:'command',command,timeout:a.timeout,...(a.nativeOptions||{}),...(a.async?{async:true}:{})}] };
}
export function mergeHookGroups(existing, previous, additions) {
  if (!existing || typeof existing!=='object' || Array.isArray(existing)) throw new Error('现有 hooks 配置无效');
  const result=structuredClone(existing);
  const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  for (const [event,groups] of Object.entries(result)) if (!Array.isArray(groups)) throw new Error(`现有 ${event} 配置必须是数组`);
  // Remove one exact copy of each owned group; preserve external groups and edits.
  for (const [event,groups] of Object.entries(previous||{})) for (const old of groups) {
    const index=(result[event]||[]).findIndex(g=>canonical(g)===canonical(old));
    if (index>=0) result[event].splice(index,1);
    else if (Object.values(result).flat().some(g=>(g.hooks||[]).some(h=>(old.hooks||[]).some(o=>h.command===o.command)))) throw new Error('助手管理的 Hook 已在项目中修改，请先将修改保存到资产或恢复原配置');
  }
  const owned={};
  for (const [event,groups] of Object.entries(additions)) for (const group of groups) {
    result[event]||=[];
    if (!result[event].some(g=>canonical(g)===canonical(group))) {
      result[event].push(group); (owned[event]||=[]).push(group);
    }
  }
  for (const event of Object.keys(result)) if (!result[event].length) delete result[event];
  return {hooks:result,owned};
}

export async function testHook(a,input,cwd) {
  const event=validateHook(a);
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('测试输入必须是 JSON 对象');
  if (input.hook_event_name!==a.event) throw new Error('测试输入的事件名称与 Hook 不一致');
  if (a.matcher && a.matcher!=='*' && !new RegExp(a.matcher).test(String(input[event.matchField]||''))) return {matched:false,summary:'匹配条件未命中，脚本未运行'};
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asset-hook-test-'));
  try {
    for (const [name,content] of Object.entries(a.files)) { const file=path.join(temp,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,content); }
    const call=invocation(a,path.join(temp,a.entry),process.platform==='win32',true);
    const start=Date.now();
    const result=await new Promise(resolve=>{
      const child=spawn(call.command,call.args,{cwd:cwd||temp,windowsHide:true,detached:process.platform!=='win32',stdio:'pipe',env:{...process.env,CLAUDE_PROJECT_DIR:cwd||temp}});
      let stdout='',stderr='',timedOut=false,outputLimited=false,error='',done=false;
      const stop=()=>{ if (!child.pid) return; if(process.platform==='win32') spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'}); else {try {process.kill(-child.pid,'SIGKILL');} catch {child.kill('SIGKILL');}} };
      const limit=Math.min(a.timeout,30);
      const timer=setTimeout(()=>{timedOut=true;stop();},limit*1000);
      const finish=exitCode=>{if(done)return;done=true;clearTimeout(timer);resolve({exitCode,stdout,stderr,timedOut,outputLimited,error,durationMs:Date.now()-start});};
      child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>100000){stdout=stdout.slice(0,100000);outputLimited=true;stop();}});
      child.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>100000){stderr=stderr.slice(0,100000);outputLimited=true;stop();}});
      child.on('error',e=>{error=e.message;finish(null);});
      child.on('close',finish); child.stdin.on('error',()=>{});
      child.stdin.end(JSON.stringify({...input,cwd:cwd||temp}));
    });
    let output=null,parseError='';
    if(result.stdout.trim()) {try {output=JSON.parse(result.stdout);}catch {parseError='输出不是完整 JSON；只有支持纯文本上下文的事件才会采用它。';}}
    if(output!==null&&(!output||typeof output!=='object'||Array.isArray(output))) parseError='结构化输出必须是 JSON 对象。';
    if(output?.hookSpecificOutput&&output.hookSpecificOutput.hookEventName!==a.event) parseError='输出的 hookEventName 与当前事件不一致。';
    const validOutput=output&&!parseError;
    const decision=validOutput?(a.event==='PreToolUse'?output.hookSpecificOutput?.permissionDecision||output.decision:a.event==='PermissionRequest'?output.hookSpecificOutput?.decision?.behavior:output.decision):null;
    const canBlock=['PreToolUse','UserPromptSubmit','Stop','SubagentStop',...(a.harness==='claude'?['ConfigChange','PreCompact']:[])].includes(a.event);
    const usable=!a.async&&!result.timedOut&&!result.outputLimited&&!result.error;
    const feedback=usable&&['PostToolUse','PostToolUseFailure'].includes(a.event)&&(result.exitCode===2||(result.exitCode===0&&decision==='block'));
    const blocked=usable&&((canBlock&&(result.exitCode===2||(result.exitCode===0&&['deny','block'].includes(decision))))||(a.event==='PermissionRequest'&&result.exitCode===0&&decision==='deny')||(a.harness==='claude'&&a.event==='WorktreeCreate'&&result.exitCode!==0));
    const summary=result.error?'运行环境或脚本启动失败':result.timedOut?'模拟测试超时（最多等待 30 秒）':result.outputLimited?'输出超过上限，已停止测试':a.async?'后台 Hook：返回的控制决定不会阻止当前操作':blocked?(a.event==='Stop'||a.event==='SubagentStop'?'请求 Agent 继续工作':'返回阻止决定'):feedback?'返回工具执行后的反馈，已完成的操作无法撤销':parseError?'请检查输出格式':result.exitCode!==0?'脚本退出异常，请结合目标软件的事件行为检查':'脚本执行完成';
    return {matched:true,...result,output,parseError,summary,blocked,simulation:true};
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
}
