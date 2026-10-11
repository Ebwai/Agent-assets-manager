import YAML from 'yaml';

export function validateRule(asset) {
  if (!asset || asset.harness !== 'claude') throw new Error('Rules 仅支持 Claude Code');
  if (typeof asset.fileName !== 'string' || asset.fileName.length>200 || asset.fileName!==asset.fileName.trim() || !/^[^<>:"/\\|?*\x00-\x1f]+\.md$/.test(asset.fileName) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(asset.fileName)) throw new Error('请使用安全的 .md 文件名，不含目录或系统保留字符');
  if (typeof asset.content !== 'string' || !asset.content.trim()) throw new Error('请填写规则正文');
  if (Buffer.byteLength(asset.content) > 200_000) throw new Error('规则正文最多 200 KB');
  if (/^\s*---(?:\r?\n|$)/.test(asset.content)) throw new Error('正文不应包含 YAML 开头；请在适用文件中填写 paths');
  if (!Array.isArray(asset.paths) || asset.paths.some(p=>typeof p!=='string'||!p.trim()||p!==p.trim()||p.length>500||/^[\/\\]|^[A-Za-z]:|\\|[\r\n\0]/.test(p)||p.split('/').includes('..'))) throw new Error('适用文件须为项目内的相对 glob 路径，每行一条');
  if(asset.paths.length>100) throw new Error('适用文件最多 100 条');
}

export function renderRule(asset) {
  validateRule(asset);
  return (asset.paths.length?'---\n'+YAML.stringify({paths:asset.paths})+'---\n\n':'')+asset.content.trimEnd()+'\n';
}

export function parseRule(text, fileName) {
  if(typeof text!=='string'||Buffer.byteLength(text)>200_000) throw new Error('规则文件必须是 200 KB 以内的文本');
  let content=text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'), paths=[], ignoredFields=[];
  if(content.startsWith('---\n')) {
    const end=content.indexOf('\n---',3);
    if(end<0 || !/^\n---(?:\n|$)/.test(content.slice(end))) throw new Error('规则 YAML 分隔符不完整');
    let header;
    try { header=YAML.parse(content.slice(4,end)); } catch { throw new Error('规则 YAML 格式无效'); }
    if(header!==null&&(!header||typeof header!=='object'||Array.isArray(header))) throw new Error('规则 YAML 必须是对象');
    if(header?.paths!==undefined) {
      if(typeof header.paths==='string') {
        paths=[];let depth=0,start=0;
        for(let i=0;i<header.paths.length;i++){const char=header.paths[i];if(char==='{')depth++;if(char==='}')depth--;if(char===','&&depth===0){paths.push(header.paths.slice(start,i).trim());start=i+1;}}
        paths.push(header.paths.slice(start).trim());
      } else paths=header.paths;
    }
    ignoredFields=Object.keys(header||{}).filter(k=>k!=='paths');
    content=content.slice(end+4).replace(/^\n+/,'');
  }
  const asset={title:fileName.replace(/\.md$/i,''),description:'',harness:'claude',fileName,paths,content};
  validateRule(asset);
  return {asset,ignoredFields};
}
