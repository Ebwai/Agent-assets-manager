import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createPluginStore,githubRepository} from '../plugins.mjs';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'asset-plugins-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const upstream=path.join(root,'upstream');fs.mkdirSync(upstream);git(upstream,'init','-b','main');git(upstream,'config','user.name','Tests');git(upstream,'config','user.email','test@localhost');
  fs.writeFileSync(path.join(upstream,'readme.txt'),'initial\n');git(upstream,'add','.');git(upstream,'commit','-m','initial');
  let releases=[];
  const store=createPluginStore(path.join(root,'data'),{validateRemote:url=>({url,slug:path.basename(url)}),releaseFetch:async()=>({ok:true,json:async()=>releases})});
  const change=(name,content)=>{fs.writeFileSync(path.join(upstream,name),content);git(upstream,'add','.');git(upstream,'commit','-m','upstream update');};
  return {root,upstream,store,change,releases:value=>{releases=value;}};
}

test('GitHub URL validation accepts repository links and rejects commands and non-GitHub destinations',()=>{
  assert.equal(githubRepository('https://github.com/owner/package.git').slug,'owner/package');
  assert.equal(githubRepository('git@github.com:owner/package.git').slug,'owner/package');
  for(const url of ['-u','https://evil.test/x/y','https://github.com/a/b?token=secret','https://github.com/../x'])assert.throws(()=>githubRepository(url));
});

test('third-party default branch is protected; upstream refresh preserves personal changes until rebase',async t=>{
  const f=fixture(t);let p=await f.store.create({title:'Test',ownership:'third-party',url:f.upstream});const id=p.id;
  assert.equal(p.readOnly,true);
  await assert.rejects(f.store.action(id,'save',{message:'personal change',files:[{path:'mine.txt',content:'mine'}]}),/默认分支只读/);
  assert.equal(fs.existsSync(path.join(p.directory,'mine.txt')),false);
  p=await f.store.action(id,'branch',{name:'my-changes',create:true});assert.equal(p.readOnly,false);
  await f.store.action(id,'save',{message:'personal change',files:[{path:'mine.txt',content:'mine'}]});
  f.change('upstream.txt','new');git(f.upstream,'tag','v2');f.releases([{tag_name:'v2',name:'Version two',body:'release notes',prerelease:false}]);
  p=await f.store.action(id,'check');assert.equal(p.commitUpdates,1);assert.equal(p.releases[0].adopted,false);
  assert.match((await f.store.action(id,'upstream-diff')).diff,/upstream.txt/);
  p=await f.store.action(id,'update');assert.equal(p.currentBranch,'my-changes');assert.equal(p.commitUpdates,0);assert.equal(p.releases[0].adopted,true);
  assert.equal(fs.existsSync(path.join(p.directory,'upstream.txt')),false);
  p=await f.store.action(id,'rebase');assert.equal(p.rebasing,false);assert.equal(fs.readFileSync(path.join(p.directory,'mine.txt'),'utf8'),'mine');assert.equal(fs.readFileSync(path.join(p.directory,'upstream.txt'),'utf8'),'new');
  await f.store.action(id,'branch',{name:'main'});await assert.rejects(f.store.action(id,'commit',{message:'cannot modify default'}),/默认分支只读/);
});

test('rebase conflicts can be aborted or resolved and continued without changing upstream branch',async t=>{
  const f=fixture(t);let p=await f.store.create({title:'Conflict',ownership:'third-party',url:f.upstream});const id=p.id;
  await f.store.action(id,'branch',{name:'custom',create:true});await f.store.action(id,'save',{message:'custom readme',files:[{path:'readme.txt',content:'custom\n'}]});
  f.change('readme.txt','upstream\n');p=await f.store.action(id,'rebase');assert.equal(p.rebasing,true);assert.deepEqual(p.conflicts,['readme.txt']);
  await assert.rejects(f.store.action(id,'branch',{name:'other',create:true}),/完成或取消/);
  p=await f.store.action(id,'abort');assert.equal(p.currentBranch,'custom');assert.equal(fs.readFileSync(path.join(p.directory,'readme.txt'),'utf8'),'custom\n');
  await f.store.action(id,'rebase');await f.store.action(id,'resolve',{path:'readme.txt',content:'custom and upstream\n'});p=await f.store.action(id,'continue');assert.equal(p.rebasing,false);assert.equal(p.currentBranch,'custom');assert.equal(git(p.directory,'show','main:readme.txt'),'upstream');assert.equal(fs.readFileSync(path.join(p.directory,'readme.txt'),'utf8'),'custom and upstream\n');
});

test('Fork receives personal branch and default branch cannot be pushed; new branch push is supported',async t=>{
  const f=fixture(t),fork=path.join(f.root,'fork.git');git(f.root,'clone','--bare',f.upstream,fork);
  let p=await f.store.create({title:'Fork',ownership:'third-party',url:f.upstream});const id=p.id;
  await assert.rejects(f.store.action(id,'remote',{url:f.upstream}),/自己的 Fork/);
  await f.store.action(id,'remote',{url:fork});await assert.rejects(f.store.action(id,'push'),/默认分支只读/);
  p=await f.store.action(id,'push',{newBranch:'custom'});assert.equal(p.currentBranch,'custom');assert.equal(git(fork,'rev-parse','refs/heads/custom'),p.head);
  await f.store.action(id,'save',{message:'my file saved',files:[{path:'mine.txt',content:'mine'}]});p=await f.store.action(id,'push');assert.equal(git(fork,'rev-parse','refs/heads/custom'),p.head);
});

test('local packages preserve binary files and validate entire save before writes',async t=>{
  const f=fixture(t);const source=path.join(f.root,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'data.bin'),Buffer.from([0,1,255]));
  let p=await f.store.create({title:'Local',ownership:'local',directory:source});assert.equal(p.files[0].path,'data.bin');assert.equal((await f.store.action(p.id,'file',{path:'data.bin'})).binary,true);
  for(const name of ['../outside','.git/config','.git./config','CON','a\\b','/absolute','file:stream'])await assert.rejects(f.store.action(p.id,'save',{message:'invalid filename',files:[{path:'good.txt',content:'must not write'},{path:name,content:'bad'}]}),/路径无效/);
  assert.equal(fs.existsSync(path.join(p.directory,'good.txt')),false);
  await assert.rejects(f.store.action(p.id,'save',{message:'x',files:[{path:'good.txt',content:'no'}]}),/版本说明/);
  p=await f.store.action(p.id,'save',{message:'binary upload',files:[{path:'asset.bin',content:Buffer.from([4,0,6]).toString('base64'),encoding:'base64'}]});assert.equal(p.dirty,false);assert.deepEqual(fs.readFileSync(path.join(p.directory,'asset.bin')),Buffer.from([4,0,6]));
  const old=p.head;
  await f.store.action(p.id,'save',{message:'change binary file',files:[{path:'asset.bin',content:'changed'}]});
  p=await f.store.action(p.id,'restore',{hash:old,message:'restore earlier package'});assert.notEqual(p.head,old);assert.deepEqual(fs.readFileSync(path.join(p.directory,'asset.bin')),Buffer.from([4,0,6]));
  await f.store.action(p.id,'save',{message:'add ignore pattern',files:[{path:'.gitignore',content:'ignored.txt\n'}]});
  await assert.rejects(f.store.action(p.id,'save',{message:'ignored file save',files:[{path:'ignored.txt',content:'not versioned'}]}),/gitignore/);assert.equal(fs.existsSync(path.join(p.directory,'ignored.txt')),false);
});
