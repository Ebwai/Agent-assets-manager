import { repositoryComparison } from './version-diff.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function githubRepository(value) {
  const text=String(value||'').trim();
  const match=text.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if(!match || ['.','..'].includes(match[1]) || ['.','..'].includes(match[2]))throw Error('请填写 GitHub 仓库 HTTPS 或 SSH 地址');
  return {url:text,slug:`${match[1]}/${match[2]}`};
}

export function createPluginStore(dataRoot, {validateRemote=githubRepository, releaseFetch=fetch}={}) {
  const base=path.join(dataRoot,'plugins'), index=path.join(base,'index.json'), locks=new Map();
  fs.mkdirSync(base,{recursive:true});
  const read=()=>fs.existsSync(index)?JSON.parse(fs.readFileSync(index,'utf8')):[];
  const persist=items=>{const temp=index+'.tmp';fs.writeFileSync(temp,JSON.stringify(items,null,2));fs.renameSync(temp,index);};
  const find=id=>{if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('Plugin ID 无效');const p=read().find(p=>p.id===id);if(!p)throw Error('Plugin 不存在');return p;};
  const dir=p=>path.join(base,p.id);
  const git=async(p,args)=>{try{return (await exec('git',['-c','core.hooksPath='+path.join(base,'disabled-hooks'),...args],{cwd:dir(p),encoding:'utf8',maxBuffer:12_000_000,timeout:120000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_EDITOR:'true'}})).stdout.trimEnd();}catch(e){throw Error((e.stderr||e.message).trim());}};
  const optional=async(p,args)=>{try{return await git(p,args);}catch{return '';}};
  const update=p=>{const items=read(),i=items.findIndex(x=>x.id===p.id);p.updatedAt=new Date().toISOString();if(i<0)items.push(p);else items[i]=p;persist(items);};
  const locked=async(id,fn)=>{if(locks.has(id))throw Error('此 Plugin 正在执行操作，请稍后重试');locks.set(id,true);try{return await fn();}finally{locks.delete(id);}};
  const filePath=(p,name)=>{
    if(typeof name!=='string'||!name||name.length>500||/[\\:\x00-\x1f]/.test(name)||name.startsWith('/')||name.split('/').some(x=>!x||x==='.'||x==='..'||/[. ]$/.test(x)||x.toLowerCase()==='.git'||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)))throw Error('文件路径无效');
    const target=path.join(dir(p),...name.split('/'));
    let current=dir(p);for(const part of name.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('不能读写链接文件');}
    return target;
  };
  const files=p=>{const result=[];let count=0;const walk=(folder,prefix='',depth=0)=>{if(depth>20)throw Error('Plugin 目录层级过深');for(const entry of fs.readdirSync(folder,{withFileTypes:true})){if(entry.name.toLowerCase()==='.git')continue;if(++count>10000)throw Error('Plugin 文件数量超过 10000 项');const name=prefix+entry.name;if(entry.isSymbolicLink())continue;if(entry.isDirectory())walk(path.join(folder,entry.name),name+'/',depth+1);else if(entry.isFile())result.push({path:name,size:fs.statSync(path.join(folder,entry.name)).size});}};walk(dir(p));return result;};
  const branch=p=>git(p,['branch','--show-current']);
  const rebase=p=>fs.existsSync(path.join(dir(p),'.git','rebase-merge'))||fs.existsSync(path.join(dir(p),'.git','rebase-apply'));
  const writable=async(p)=>{if(rebase(p))throw Error('请先完成或取消 rebase');if(p.ownership==='third-party'&&await branch(p)===p.defaultBranch)throw Error('上游默认分支只读：请先创建或切换到自己的分支再保存修改');if(!await branch(p))throw Error('请先切换到分支');};
  const clean=async(p)=>{if(rebase(p))throw Error('请先完成或取消 rebase');if(await git(p,['status','--porcelain']))throw Error('请先保存工作区修改，再切换分支或更新');};
  const validBranch=async(p,name)=>{if(typeof name!=='string'||name.length>150||name.startsWith('-')||!name||name==='HEAD')throw Error('分支名称无效');await git(p,['check-ref-format','--branch',name]);return name;};
  const commit=async(p,message)=>{if(typeof message!=='string'||message.trim().length<3||message.length>200)throw Error('请填写 3–200 字的版本说明');await git(p,['add','--all']);if(await git(p,['diff','--cached','--name-only']))await git(p,['commit','-m',message.trim()]);};
  const status=async(p)=>{
    const currentBranch=await branch(p), head=await optional(p,['rev-parse','HEAD']);
    const upstream=p.upstreamUrl?'upstream/'+p.defaultBranch:'';
    const ahead=upstream?await optional(p,['rev-list','--count',`${p.defaultBranch}..${upstream}`]):'';
    const history=await optional(p,['log','-30','--format=%H%x09%aI%x09%s']);
    const conflicts=(await git(p,['diff','--name-only','--diff-filter=U'])).split('\n').filter(Boolean);
    const releases=await Promise.all((p.releases||[]).map(async r=>{let adopted=false;try{await git(p,['merge-base','--is-ancestor',`refs/tags/${r.tag}`,p.defaultBranch]);adopted=true;}catch{}return {...r,adopted};}));
    return {...p,releases,directory:dir(p),currentBranch,head,readOnly:p.ownership==='third-party'&&currentBranch===p.defaultBranch,dirty:!!await git(p,['status','--porcelain']),rebasing:rebase(p),conflicts,branches:(await git(p,['branch','--format=%(refname:short)'])).split('\n').filter(Boolean),commitUpdates:Number(ahead||0),commits:upstream?(await optional(p,['log',`${p.defaultBranch}..${upstream}`,'-30','--format=%H%x09%s'])).split('\n').filter(Boolean):[],history:history.split('\n').filter(Boolean).map(line=>{const [hash,date,...message]=line.split('\t');return {hash,date,message:message.join('\t')};}),files:files(p)};
  };
  const writeFiles=async(p,changes)=>{
    await writable(p);if(!Array.isArray(changes)||!changes.length||changes.length>1000)throw Error('请选择 1–1000 个文件');
    let total=0;const prepared=changes.map(f=>{const target=filePath(p,f.path);if(f.remove)return {target,remove:true};if(typeof f.content!=='string')throw Error('文件内容无效');const bytes=Buffer.from(f.content,f.encoding==='base64'?'base64':'utf8');total+=bytes.length;if(total>12_000_000)throw Error('每次保存最多 12 MB');return {target,bytes};});
    for(const f of prepared){if(f.remove){if(fs.existsSync(f.target)&&!fs.lstatSync(f.target).isFile())throw Error('只能删除文件');}else if(fs.existsSync(f.target)&&!fs.lstatSync(f.target).isFile())throw Error('目标不是普通文件');}
    const ignored=await optional(p,['check-ignore','--',...changes.filter(f=>!f.remove).map(f=>f.path)]);if(ignored)throw Error('以下文件被 .gitignore 排除，不能保存为版本：'+ignored);
    for(const f of prepared){if(f.remove){if(fs.existsSync(f.target))fs.unlinkSync(f.target);}else{fs.mkdirSync(path.dirname(f.target),{recursive:true});fs.writeFileSync(f.target,f.bytes);}}
  };
  const check=async(p)=>{
    if(!p.upstreamUrl)throw Error('此 Plugin 尚未关联上游仓库');
    await git(p,['fetch','upstream','--tags']);
    const sym=await git(p,['ls-remote','--symref','upstream','HEAD']);const detected=sym.match(/ref: refs\/heads\/(\S+)\s+HEAD/);
    if(detected&&detected[1]!==p.defaultBranch)throw Error('上游默认分支已变化，请先检查仓库设置');
    p.checkedAt=new Date().toISOString();p.releaseError='';
    try {const {slug}=validateRemote(p.upstreamUrl);const response=await releaseFetch(`https://api.github.com/repos/${slug}/releases?per_page=30`,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});let data;if(response.ok)data=await response.json();else {try{data=JSON.parse((await exec('gh',['api',`repos/${slug}/releases?per_page=30`],{encoding:'utf8',timeout:15000,maxBuffer:2_000_000})).stdout);}catch{throw Error(`GitHub Release 查询失败 (${response.status})，私有仓库请先在本机登录 GitHub CLI`);}}if(!Array.isArray(data))throw Error('Release 响应无效');p.releases=data.filter(r=>!r.draft&&typeof r.tag_name==='string').slice(0,30).map(r=>({tag:r.tag_name,name:r.name||r.tag_name,body:String(r.body||'').slice(0,12000),publishedAt:r.published_at,url:r.html_url,prerelease:!!r.prerelease}));}
    catch(e){p.releaseError=e.message;}
    const result=await status(p);p.releases=result.releases;update(p);return {...result,updatedAt:p.updatedAt};
  };
  async function create(body) {
    const title=String(body.title||'').trim();if(!title)throw Error('请填写 Plugin 名称');
    if(!['local','owned','third-party'].includes(body.ownership))throw Error('请选择仓库归属');
    if(body.ownership!=='local'&&!body.url)throw Error('请填写仓库地址');
    const remote=body.url?validateRemote(body.url):null;
    const p={id:crypto.randomUUID(),title,description:String(body.description||''),ownership:body.ownership,upstreamUrl:remote?.url||'',forkUrl:'',defaultBranch:'main',createdAt:new Date().toISOString(),releases:[]};
    fs.mkdirSync(dir(p));
    try {
      if(remote){await git(p,['clone','--origin','upstream','--',remote.url,'.']);p.defaultBranch=await branch(p);if(!p.defaultBranch)throw Error('远程仓库没有可用默认分支');if(p.ownership==='owned'){await git(p,['remote','add','origin',remote.url]);p.forkUrl=remote.url;}}
      else{await git(p,['init','-b','main']);}
      await git(p,['config','user.name','Agent Asset Manager']);await git(p,['config','user.email','agent-assets@localhost']);
      if(!remote)await git(p,['commit','--allow-empty','-m','初始化 Plugin']);
      if(body.directory){if(remote)throw Error('不能同时从远程和本地目录导入');const source=path.resolve(body.directory);if(!fs.statSync(source).isDirectory())throw Error('请选择目录');if(source===path.resolve(dataRoot)||path.resolve(base).startsWith(source+path.sep))throw Error('不能导入包含 Plugin 数据的目录');let count=0,total=0;const copy=(from,to,depth=0)=>{if(depth>20)throw Error('目录层级过深');for(const entry of fs.readdirSync(from,{withFileTypes:true})){if(entry.name.toLowerCase()==='.git')continue;if(++count>10000)throw Error('导入文件过多');if(entry.isSymbolicLink())throw Error('导入目录不能包含链接文件');const a=path.join(from,entry.name),b=path.join(to,entry.name);if(entry.isDirectory()){fs.mkdirSync(b,{recursive:true});copy(a,b,depth+1);}else if(entry.isFile()){total+=fs.statSync(a).size;if(total>64_000_000)throw Error('目录导入最多 64 MB');fs.copyFileSync(a,b);}else throw Error('不支持特殊文件');}};copy(source,dir(p));await commit(p,'导入本地 Plugin');}
      update(p);return status(p);
    }catch(e){fs.rmSync(dir(p),{recursive:true,force:true});throw e;}
  }
  async function action(id,action,body={}) {return locked(id,async()=>{
    const p=find(id);
    if(action==='detail')return status(p);
    if(action==='file'){const target=filePath(p,body.path);if(!fs.statSync(target).isFile())throw Error('请选择文件');if(fs.statSync(target).size>2_000_000)throw Error('文件过大，不能在线编辑');const bytes=fs.readFileSync(target);const text=bytes.toString('utf8');return {path:body.path,content:text,binary:bytes.includes(0)||!Buffer.from(text).equals(bytes)};}
    if(action==='save'){if(typeof body.message!=='string'||body.message.trim().length<3||body.message.length>200)throw Error('请填写 3–200 字的版本说明');await writeFiles(p,body.files);await commit(p,body.message);}
    else if(action==='commit'){await writable(p);await commit(p,body.message);}
    else if(action==='branch'){await clean(p);const name=await validBranch(p,body.name);await git(p,body.create?['switch','-c',name]:['switch',name]);}
    else if(action==='check')return check(p);
    else if(action==='update'){
      await clean(p);await check(p);const previous=await branch(p);await git(p,['switch',p.defaultBranch]);
      try{await git(p,['merge','--ff-only','upstream/'+p.defaultBranch]);}finally{if(previous!==p.defaultBranch)await git(p,['switch',previous]);}
    }
    else if(action==='rebase'){await writable(p);await clean(p);const previous=await branch(p);if(previous===p.defaultBranch)throw Error('请先切换到自己的分支');await check(p);await git(p,['switch',p.defaultBranch]);try{await git(p,['merge','--ff-only','upstream/'+p.defaultBranch]);}finally{await git(p,['switch',previous]);}try{await git(p,['rebase',p.defaultBranch]);}catch(e){if(!rebase(p))throw e;}}
    else if(action==='resolve'){if(!rebase(p))throw Error('没有待处理的 rebase');const conflicts=(await git(p,['diff','--name-only','--diff-filter=U'])).split('\n');if(!conflicts.includes(body.path))throw Error('此文件不是冲突文件');const target=filePath(p,body.path);if(body.remove){if(fs.existsSync(target))fs.unlinkSync(target);await git(p,['add','--',body.path]);}else{if(typeof body.content!=='string'||Buffer.byteLength(body.content)>2_000_000)throw Error('冲突内容无效或过大');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,body.content);await git(p,['add','--',body.path]);}}
    else if(action==='continue'){if(!rebase(p))throw Error('没有待处理的 rebase');try{await git(p,['-c','core.editor=true','rebase','--continue']);}catch(e){if(!(await git(p,['diff','--name-only','--diff-filter=U'])))throw e;}}
    else if(action==='abort'){if(!rebase(p))throw Error('没有待处理的 rebase');await git(p,['rebase','--abort']);}
    else if(action==='remote'){await clean(p);const remote=validateRemote(body.url);if(p.ownership==='third-party'&&remote.slug===validateRemote(p.upstreamUrl).slug)throw Error('他人项目的修改必须推送到自己的 Fork');if(await optional(p,['remote','get-url','origin']))await git(p,['remote','set-url','origin',remote.url]);else await git(p,['remote','add','origin',remote.url]);p.forkUrl=remote.url;if(!p.upstreamUrl){await git(p,['remote','add','upstream',remote.url]);p.upstreamUrl=remote.url;p.ownership='owned';}update(p);}
    else if(action==='push'){await clean(p);if(!p.forkUrl)throw Error('请先关联自己的 GitHub 仓库或 Fork');if(body.newBranch){await git(p,['switch','-c',await validBranch(p,body.newBranch)]);}await writable(p);const current=await branch(p);await git(p,['push','--set-upstream','origin',current]);}
    else if(action==='upstream-diff'){if(!p.upstreamUrl)throw Error('尚未关联上游');return {...await repositoryComparison(dir(p),null,{beforeRef:p.defaultBranch,afterRef:'upstream/'+p.defaultBranch}),diff:await git(p,['diff','--no-ext-diff','--no-textconv',p.defaultBranch,'upstream/'+p.defaultBranch])};}
    else if(action==='restore'){await writable(p);await clean(p);if(!/^[a-f0-9]{40}$/.test(body.hash||''))throw Error('版本无效');if(typeof body.message!=='string'||body.message.trim().length<3||body.message.length>200)throw Error('请填写 3–200 字的版本说明');await git(p,['cat-file','-e',body.hash+'^{commit}']);await git(p,['restore','--source='+body.hash,'--staged','--worktree','--','.']);await commit(p,body.message);}
    else if(action==='diff')return {...await repositoryComparison(dir(p),body.hash),diff:await git(p,['show','--format=','--root','--first-parent','--no-ext-diff','--no-textconv',body.hash,'--'])};
    else if(action==='metadata'){if(!String(body.title||'').trim())throw Error('请填写名称');p.title=String(body.title).trim();p.description=String(body.description||'');update(p);}
    else throw Error('未知 Plugin 操作');
    const result=await status(p);p.releases=result.releases;update(p);return {...result,updatedAt:p.updatedAt};
  });}
  return {create,action,list:()=>read(),directory:id=>dir(find(id)),withLock:locked};
}
