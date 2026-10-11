import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { parseRule } from './rules.mjs';
import { parseHookConfiguration } from './hook-import.mjs';
import { assertHookDestination } from './hooks.mjs';

// Discovery reads known asset locations only. It never follows links or runs code.
export function scanProjectAssets(directory, projectId, parseSkill, validate, options = {}) {
  const candidates=[], warnings=[];
  let visited=0,bytesRead=0;
  const read=(relative,limit=512000)=>{
    const file=path.join(directory,relative);assertHookDestination(directory,file);
    if(!fs.statSync(file).isFile())throw Error('来源不是普通文件');
    const size=fs.statSync(file).size;
    if(size>limit)throw Error('来源文件超过大小限制');
    bytesRead+=size;if(bytesRead>64_000_000)throw Error('本次扫描读取内容超过 64 MB，请分批整理后重试');
    return fs.readFileSync(file);
  };
  const walk=(relative,depth=0)=>{
    const dir=path.join(directory,relative);
    try {
      assertHookDestination(directory,dir);
      if(!fs.existsSync(dir))return [];
      if(depth>15)throw Error('目录层级超过 15 层');
      if(fs.existsSync(path.join(dir,'.agent-asset-id')))return [];
      const result=[];
      for(const item of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
        if(++visited>3000)throw Error('扫描文件数量超过 3000 项');
        const name=path.posix.join(relative,item.name);
        if(item.isSymbolicLink()){warnings.push(`${name}：跳过链接`);continue;}
        if(item.isDirectory())result.push(...walk(name,depth+1));
        else if(item.isFile())result.push(name);
      }
      return result;
    }catch(error){warnings.push(`${relative}：${error.message}`);return [];}
  };
  const add=(source,type,harness,build,extra='')=>{
    if(candidates.length>=500){if(!warnings.includes('最多展示 500 个资产'))warnings.push('最多展示 500 个资产');return;}
    const item={key:`${harness}:${type}:${source}${extra}`,source,type,harness,title:path.basename(source),warnings:[]};
    let content;
    try{content=read(source);item.asset=build(content.toString('utf8'),item);validate(type,item.asset);item.title=item.asset.title;item.importable=true;}
    catch(error){item.importable=false;item.error=error.message;}
    item.fingerprint=crypto.createHash('sha256').update(JSON.stringify({content:content?.toString('base64'),asset:item.asset,error:item.error})).digest('hex');
    candidates.push(item);
  };
  for(const [base,harness] of [['.claude/skills','claude'],['.agents/skills','codex'],['.codex/skills','codex'],...(options.plugin?[['skills','claude']]:[])]){
    for(const source of walk(base).filter(p=>path.basename(p)==='SKILL.md'))add(source,'skill',harness,(text,item)=>{
      const parsed=parseSkill(text),frontmatter={...parsed.frontmatter};
      for(const key of parsed.unknownFields)delete frontmatter[key];
      if(parsed.unknownFields.length)item.warnings.push(`忽略未知字段：${parsed.unknownFields.join('、')}`);
      const files={},parent=path.posix.dirname(source);let total=0;
      for(const resource of ['scripts','references','assets'].flatMap(folder=>walk(`${parent}/${folder}`))){
        const bytes=read(resource,10_000_000);total+=bytes.length;if(total>12_000_000)throw Error('Skill 资源超过 12 MB');
        const name=resource.slice(parent.length+1);
        files[name]=/\.(md|txt|py|js|mjs|cjs|json|ya?ml|sh|ps1|csv|xml|html|css|svg)$/i.test(name)?bytes.toString('utf8'):{encoding:'base64',data:bytes.toString('base64')};
      }
      return {title:frontmatter.name||path.posix.basename(parent),description:frontmatter.description||'',variants:{[harness]:{frontmatter,body:parsed.body}},files};
    });
  }
  for(const source of (options.plugin?[...walk('.claude/rules'),...walk('rules')]:walk('.claude/rules')).filter(p=>p.endsWith('.md')))add(source,'rule','claude',(text,item)=>{
    const parsed=parseRule(text,path.basename(source));if(parsed.ignoredFields.length)item.warnings.push(`忽略字段：${parsed.ignoredFields.join('、')}`);return parsed.asset;
  });
  for(const [source,harness] of [['CLAUDE.md','claude'],['.claude/CLAUDE.md','claude'],['CLAUDE.local.md','claude'],['AGENTS.md','codex']]){
    if(fs.existsSync(path.join(directory,source))){
      try{if(!read(source).toString('utf8').replace(/<!-- Agent Asset Manager: start -->[\s\S]*?<!-- Agent Asset Manager: end -->/g,'').trim())continue;}catch{}
      add(source,'prompt',harness,text=>({title:source,description:'项目现有指令',scope:'project',target:projectId,content:text.replace(/<!-- Agent Asset Manager: start -->[\s\S]*?<!-- Agent Asset Manager: end -->/g,'').trim()}));
    }
  }
  for(const source of (options.plugin?[...walk('.claude/agents'),...walk('agents')]:walk('.claude/agents')).filter(p=>p.endsWith('.md')))add(source,'agent','claude',(text,item)=>{
    const parsed=parseSkill(text),f=parsed.frontmatter;
    const unsupported=Object.keys(f).filter(k=>!['name','description','tools'].includes(k));
    if(unsupported.length)item.warnings.push(`仅导入指令和工具；原生字段未转换：${unsupported.join('、')}。此资产不是原生子 Agent 的完整备份。`);
    return {title:f.name||path.basename(source,'.md'),description:f.description||'',harness:'claude',instructions:parsed.body,tools:Array.isArray(f.tools)?f.tools:String(f.tools||'').split(',').map(s=>s.trim()).filter(Boolean),mcps:[],skillIds:[],workflowIds:[],promptIds:[],hookIds:[],ruleIds:[]};
  });
  for(const [source,harness] of [['.claude/settings.json','claude'],['.claude/settings.local.json','claude'],['.codex/hooks.json','codex'],['.codex/config.toml','codex'],...(options.plugin?[['hooks/hooks.json','claude']]:[])]){
    if(!fs.existsSync(path.join(directory,source)))continue;
    try{
      const parsed=parseHookConfiguration(read(source).toString('utf8'),harness,source);
      let owned={};
      try{owned=JSON.parse(read(`.agent-asset-manager/${harness}.json`).toString('utf8')).hooks||{};}catch{}
      for(const entry of parsed.candidates){
        if((owned[entry.raw.event]||[]).some(g=>(g.hooks||[]).some(h=>JSON.stringify(h)===JSON.stringify(entry.raw.handler))))continue;
        const rawKey=entry.key.slice(entry.key.indexOf('#'));
        add(source,'hook',harness,(_text,item)=>{
          item.raw=entry.raw;item.warnings.push(...entry.warnings);
          if(!entry.importable)throw Error(entry.error);
          return entry.asset;
        },rawKey);
      }
    }catch(error){warnings.push(`${source}：${error.message}`);}
  }
  return {candidates,warnings};
}
