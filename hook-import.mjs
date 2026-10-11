import {parse as parseToml} from 'smol-toml';
import {validateHook} from './hooks.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function parseHookConfiguration(content,harness,fileName='hooks.json') {
  if(!['claude','codex'].includes(harness))throw Error('请选择配置对应的 Claude Code 或 Codex');
  if(typeof content!=='string'||Buffer.byteLength(content)>512000)throw Error('Hook 配置文件不能超过 500 KB');
  let config;
  try{config=/\.toml$/i.test(fileName)?parseToml(content.replace(/^\uFEFF/,'')):JSON.parse(content.replace(/^\uFEFF/,''));}
  catch(error){throw Error(`配置解析失败：${error.message}`);}
  if(!object(config)||!object(config.hooks))throw Error('配置必须包含 hooks 对象；请选择设置文件或 Hooks 配置文件');
  const candidates=[];
  const add=(event,group,handler,i,j,error)=>{
    if(candidates.length>=500)throw Error('单次最多识别 500 条 Hook');
    const item={key:`${harness}:hook:${fileName}#${event}:${i}:${j}`,source:`${fileName} · ${event} · ${i+1}.${j+1}`,type:'hook',harness,title:`${event} Hook ${i+1}.${j+1}`,warnings:[],raw:{event,group:object(group)?Object.fromEntries(Object.entries(group).filter(([key])=>key!=='hooks')):group,handler}};
    try{
      if(error)throw Error(error);
      if(!object(handler)||handler.type!=='command'||typeof handler.command!=='string'||!handler.command.trim())throw Error('当前编辑器仅支持 command Hook；此原生类型可以识别但暂不能导入');
      const allowed=['type','command','timeout','async',...(harness==='codex'?['commandWindows','command_windows','statusMessage','status_message','additionalContextLimit','additional_context_limit']:[])];
      const unknown=Object.keys(handler).filter(k=>!allowed.includes(k));
      const groupUnknown=Object.keys(group).filter(k=>!['matcher','hooks'].includes(k));
      if(unknown.length||groupUnknown.length)throw Error(`尚未支持的配置字段：${[...unknown,...groupUnknown].join('、')}；已保留原配置供查看`);
      const windows=handler.commandWindows??handler.command_windows;
      if(windows!==undefined&&(typeof windows!=='string'||!windows.trim()))throw Error('Windows 命令覆盖必须是非空字符串');
      const nativeOptions={};
      const status=handler.statusMessage??handler.status_message,limit=handler.additionalContextLimit??handler.additional_context_limit;
      if(status!==undefined)nativeOptions.statusMessage=status;
      if(limit!==undefined)nativeOptions.additionalContextLimit=limit;
      const command=windows===undefined?JSON.stringify(handler.command):`process.platform === 'win32' ? ${JSON.stringify(windows)} : ${JSON.stringify(handler.command)}`;
      const script=`import { spawn } from 'node:child_process';\nconst command = ${command};\nconst child = spawn(command, { shell: true, stdio: 'inherit', cwd: process.cwd() });\nchild.on('error', e => { console.error(e.message); process.exitCode = 1; });\nchild.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });\n`;
      const timeout=harness==='codex'&&['SessionEnd','Interrupt'].includes(event)?1:harness==='claude'&&event==='UserPromptSubmit'?30:600;
      item.asset={title:item.title,description:'从原生 Hooks 配置导入',harness,event,matcher:group.matcher??'',async:handler.async??false,timeout:handler.timeout??timeout,runtime:'node',entry:'scripts/main.mjs',files:{'scripts/main.mjs':script},...(Object.keys(nativeOptions).length?{nativeOptions}:{})};
      validateHook(item.asset);item.importable=true;
      item.warnings.push('导入保留原命令，通过 Node 启动本机默认命令解释器。不会执行命令，也不会复制命令引用的脚本；生效前请检查脚本路径、解释器和依赖。');
    }catch(e){item.importable=false;item.error=e.message;delete item.asset;}
    candidates.push(item);
  };
  for(const [event,groups] of Object.entries(config.hooks)){
    if(!Array.isArray(groups)){add(event,groups,null,0,0,'事件配置必须为数组');continue;}
    groups.forEach((group,i)=>{
      if(!object(group)||!Array.isArray(group.hooks)){add(event,group,null,i,0,'事件分组必须包含 hooks 数组');return;}
      group.hooks.forEach((handler,j)=>add(event,group,handler,i,j));
    });
  }
  return {candidates,warnings:[],imported:0,skipped:0};
}
