import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { compareFiles, assetFiles, textRows } from '../version-diff.mjs';
import { createPluginStore } from '../plugins.mjs';
import { diffHTML } from '../public/version-diff.js';

test('file differences hide unchanged files and config values, preserve resources and highlight words',()=>{
  const before={variants:{common:{frontmatter:{name:'check'},body:'Read the file.'}},files:{'references/中文.md':'old\n','unchanged.txt':'same','empty.txt':''},tools:['Read'],updatedAt:'yesterday'};
  const after=structuredClone(before);after.variants.common.body='Read the file carefully.';after.files['references/中文.md']='new\n';delete after.files['empty.txt'];after.tools=['Read','Grep'];after.updatedAt='today';
  const files=compareFiles(assetFiles(before,'skill'),assetFiles(after,'skill'));
  assert.deepEqual(files.map(f=>f.path).sort(),['SKILL.md','references/中文.md','empty.txt','资产配置'].sort());
  assert.deepEqual(files.find(f=>f.path==='资产配置').changes.map(c=>c.field),['tools']);
  assert.equal(files.find(f=>f.path==='empty.txt').status,'del');
  assert.ok(files.find(f=>f.path==='SKILL.md').rows.some(r=>r.tokens?.some(t=>t.changed&&t.text.includes('carefully'))));
  const config=compareFiles({'config.json':'{"timeout":3,"same":true}'},{'config.json':'{"timeout":5,"same":true}'});
  assert.deepEqual(config[0].changes.map(c=>c.field),['timeout']);
  assert.equal(compareFiles({'file.bin':{data:'AA=='}},{'file.bin':{data:'AQ=='}})[0].binary,true);
  assert.ok(compareFiles({'config.json':'{"a":1}'},{'config.json':'{ "a": 1 }'})[0].rows.length);
});

test('viewer escapes content, folds unchanged context, retains red and green changes',()=>{
  const before=Array.from({length:40},(_,i)=>`line ${i}`).join('\n');
  const rows=textRows(before,before.replace('line 20','<script>evil</script>'));
  const html=diffHTML({before:'a'.repeat(40),after:'b'.repeat(40),files:[{path:'<img>.md',status:'modify',rows}]});
  assert.match(html,/vd-del/);assert.match(html,/vd-add/);assert.match(html,/展开 .* 行未变化内容/);
  assert.doesNotMatch(html,/<script>|<img>/);assert.match(html,/&lt;script&gt;/);
  assert.match(diffHTML({before:null,after:'a'.repeat(40),files:[]}),/首次版本/);
});

test('plugin history compares selected commit to its parent, unaffected by newer commits or dirty files',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'asset-diff-plugin-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=createPluginStore(root);let plugin=await store.create({title:'Diff test',ownership:'local'});
  const initial=plugin.head;
  plugin=await store.action(plugin.id,'save',{message:'first files',files:[{path:'references/中文.md',content:'first\n'},{path:'config.json',content:'{"timeout":3,"same":true}'},{path:'empty.txt',content:''}]});
  const first=plugin.head;
  plugin=await store.action(plugin.id,'save',{message:'second version',files:[{path:'references/中文.md',content:'second\n'},{path:'config.json',content:'{"timeout":5,"same":true}'},{path:'empty.txt',remove:true}]});
  const second=plugin.head;
  await store.action(plugin.id,'save',{message:'third version',files:[{path:'references/中文.md',content:'third\n'}]});
  fs.writeFileSync(path.join(store.directory(plugin.id),'references/中文.md'),'dirty\n');
  const result=await store.action(plugin.id,'diff',{hash:second});
  assert.equal(result.before,first);assert.equal(result.after,second);
  const ref=result.files.find(f=>f.path==='references/中文.md');
  assert.deepEqual(ref.rows.map(r=>[r.kind,r.text]),[['del','first'],['add','second']]);
  assert.deepEqual(result.files.find(f=>f.path==='config.json').changes.map(c=>c.field),['timeout']);
  assert.equal(result.files.find(f=>f.path==='empty.txt').status,'del');
  assert.equal((await store.action(plugin.id,'diff',{hash:initial})).before,null);
  await assert.rejects(store.action(plugin.id,'diff',{hash:'invalid'}),/版本无效/);
});

test('asset history compares to preceding asset version even across unrelated commits',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'asset-diff-history-'));
  const port=55000+Math.floor(Math.random()*8000);
  const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,ASSET_DATA_DIR:root,PORT:String(port)},stdio:'ignore'});
  t.after(async()=>{server.kill();await new Promise(resolve=>server.once('exit',resolve));fs.rmSync(root,{recursive:true,force:true});});
  const request=async(url,method='GET',body)=>{
    const res=await fetch(`http://127.0.0.1:${port}/api/${url}`,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    const data=await res.json();if(!res.ok)throw Error(data.error);return data;
  };
  for(let i=0;i<100;i++){try{await request('bootstrap');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  const skill=await request('skill','POST',{message:'创建测试技能',asset:{title:'差异测试',variants:{common:{frontmatter:{name:'diff-test',description:'测试差异'},body:'first'}},files:{'references/a.md':'first reference','references/same.txt':'same'}}});
  const first=(await request(`skill/${skill.id}/history`))[0].hash;
  await request('prompt','POST',{message:' unrelated asset ',asset:{title:'Other',content:'not part of this skill',scope:'global'}});
  skill.variants.common.body='second';skill.files['references/a.md']='second reference';
  await request('skill','POST',{message:'第二个版本',asset:skill});
  const second=(await request(`skill/${skill.id}/history`))[0].hash;
  skill.variants.common.body='third';await request('skill','POST',{message:'第三个版本',asset:skill});
  const result=await request(`skill/${skill.id}/diff?hash=${second}`);
  assert.equal(result.before,first);assert.equal(result.after,second);
  assert.deepEqual(result.files.map(f=>f.path).sort(),['SKILL.md','references/a.md']);
  assert.ok(result.files[1].rows.some(r=>r.kind==='add'&&r.text==='second'));
  const initial=await request(`skill/${skill.id}/diff?hash=${first}`);
  assert.equal(initial.before,null);assert.ok(initial.files.every(f=>f.status==='add'));
});
