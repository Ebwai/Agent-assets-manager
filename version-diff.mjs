import { diffLines, diffWordsWithSpace, diffChars } from 'diff';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { parse as parseToml } from 'smol-toml';

const exec = promisify(execFile);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const display = value => typeof value === 'string' ? value : JSON.stringify(value,null,2);

export function textRows(before='',after='') {
  const rows=[]; let oldLine=1,newLine=1;
  for(const part of (diffLines(before,after,{timeout:500}) || [{value:before,removed:true},{value:after,added:true}])) {
    const lines=part.value.split('\n'); if(lines.at(-1)==='')lines.pop();
    for(const text of lines)rows.push({kind:part.added?'add':part.removed?'del':'context',text,oldLine:part.added?null:oldLine++,newLine:part.removed?null:newLine++});
  }
  // Pair adjacent removal/addition groups for precise highlighting within a line.
  for(let i=0;i<rows.length;i++) {
    if(rows[i].kind!=='del')continue;
    let end=i;while(rows[end]?.kind==='del')end++;
    let addEnd=end;while(rows[addEnd]?.kind==='add')addEnd++;
    if(end-i===addEnd-end)for(let n=0;n<end-i;n++) {
      const old=rows[i+n],next=rows[end+n];
      const compare = /[\u3400-\u9fff]/.test(old.text+next.text) ? diffChars : diffWordsWithSpace;
      const words=compare(old.text,next.text,{timeout:50}) || [{value:old.text,removed:true},{value:next.text,added:true}];
      old.tokens=words.filter(w=>!w.added).map(w=>({text:w.value,changed:!!w.removed}));
      next.tokens=words.filter(w=>!w.removed).map(w=>({text:w.value,changed:!!w.added}));
    }
    i=addEnd> end?addEnd-1:end-1;
  }
  return rows;
}

export function configChanges(before,after,prefix='') {
  if(equal(before,after))return [];
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  if((before===undefined||object(before))&&(after===undefined||object(after))) {
    return [...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].flatMap(key=>configChanges(before?.[key],after?.[key],prefix?prefix+'.'+key:key));
  }
  return [{field:prefix||'内容',kind:before===undefined?'add':after===undefined?'del':'modify',rows:textRows(before===undefined?'':display(before),after===undefined?'':display(after))}];
}

function parsedConfig(name,text) {
  if(!text)return undefined;
  try {
    if(/\.json$/i.test(name))return JSON.parse(text);
    if(/\.ya?ml$/i.test(name))return YAML.parse(text);
    if(/\.toml$/i.test(name))return parseToml(text);
  }catch{}
  return undefined;
}

export function compareFiles(before={},after={}) {
  const files=[];
  for(const name of [...new Set([...Object.keys(before),...Object.keys(after)])]) {
    const old=before[name],next=after[name];if(equal(old,next))continue;
    const file={path:name,status:old===undefined?'add':next===undefined?'del':'modify'};
    if(typeof old==='object'||typeof next==='object') {
      if(old?.config||next?.config){file.changes=configChanges(old?.value,next?.value);if(!file.changes.length)continue;}
      else file.binary=true;
    } else {
      const oldConfig=parsedConfig(name,old),newConfig=parsedConfig(name,next);
      if((old===undefined||oldConfig!==undefined)&&(next===undefined||newConfig!==undefined))file.changes=configChanges(oldConfig,newConfig);
      else file.rows=textRows(old||'',next||'');
    }
    // Formatting-only changes must remain visible even if parsed values are equal.
    if(file.changes?.length===0){file.changes=undefined;file.rows=textRows(old||'',next||'');}
    files.push(file);
  }
  return files;
}

export function assetFiles(asset,type) {
  if(!asset)return {};
  const files={};
  const project=(value,prefix='')=>{
    for(const [name,content] of Object.entries(value.files||{}))files[prefix+name]=content;
    for(const [variant,v] of Object.entries(value.variants||{})) {
      const name=variant==='common'?'SKILL.md':`variants/${variant}/SKILL.md`;
      files[prefix+name]='---\n'+YAML.stringify(v.frontmatter||{})+'---\n\n'+(v.body||'');
      if(v.graph) files[prefix+(variant==='common'?'画板.json':`variants/${variant}/画板.json`)]=JSON.stringify(v.graph,null,2);
    }
    const config={...value};
    for(const key of ['id','createdAt','updatedAt','files','variants','profiles'])delete config[key];
    for(const [key,name] of Object.entries({content:'内容.md',instructions:'指令.md',body:'正文.md',script:'脚本',reviewSystem:'审查提示词.md',improveSystem:'改进提示词.md',visualizeSystem:'可视化提示词.md',syncGraphSystem:'画板同步提示词.md'})) {
      if(typeof config[key]==='string'){files[prefix+name]=config[key];delete config[key];}
    }
    if(Object.keys(config).length)files[prefix+'资产配置']={config:true,value:config};
  };
  project(asset);
  for(const [name,profile] of Object.entries(asset.profiles||{}))project(profile,`profiles/${name}/`);
  return files;
}

export async function repositoryComparison(directory,hash,{beforeRef,afterRef}={}) {
  const git=async args=>(await exec('git',['-c','core.hooksPath='+directory+'/.disabled-diff-hooks',...args],{cwd:directory,encoding:'buffer',maxBuffer:16_000_000,timeout:30000})).stdout;
  let before=beforeRef,after=afterRef;
  if(!after) {
    if(!/^[a-f0-9]{40}$/.test(hash||''))throw Error('版本无效');
    const lineage=(await git(['rev-list','--parents','-n','1',hash])).toString().trim().split(' ');
    after=lineage[0];before=lineage[1]||null;
  }
  const args=before?['diff','--no-ext-diff','--no-renames','--name-status','-z',before,after,'--']:['diff-tree','--root','--no-commit-id','-r','--no-renames','--name-status','-z',after,'--'];
  const names=(await git(args)).toString().split('\0');const oldFiles={},newFiles={};
  const read=async(ref,name)=>{
    const bytes=await git(['show',`${ref}:${name}`]);const text=bytes.toString('utf8');
    return bytes.includes(0)||!Buffer.from(text).equals(bytes)?{binary:true,data:bytes.toString('base64')}:text;
  };
  for(let i=0;i+1<names.length;i+=2) {
    const status=names[i],name=names[i+1];if(!name)continue;
    if(status!=='A'&&before)oldFiles[name]=await read(before,name);
    if(status!=='D')newFiles[name]=await read(after,name);
  }
  return {before,after,files:compareFiles(oldFiles,newFiles)};
}
