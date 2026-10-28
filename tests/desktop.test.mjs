import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),testRoot=process.env.NDZD_TEST_APP_ROOT,{Library}=require(testRoot?path.join(testRoot,'desktop/library.cjs'):'../desktop/library.cjs'),sharp=require(testRoot?path.join(testRoot,'node_modules/sharp'):'sharp');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ndzd-test-')),root=path.join(dir,'photos'),trash=path.join(dir,'trash');await fs.mkdir(root);await fs.mkdir(trash);t.after(()=>fs.rm(dir,{recursive:true,force:true}));await sharp({create:{width:120,height:80,channels:3,background:'#a33'}}).jpeg().toFile(path.join(root,'scan.jpg'));const library=new Library(path.join(dir,'settings'),file=>fs.rename(file,path.join(trash,path.basename(file))));await library.init();await library.open(root);return {dir,root,trash,library};}
test('real files: rename, full resolution save, baseline, restart, three independent scans and Trash',async t=>{const {root,trash,library,dir}=await fixture(t);let r=library.archive().rolls[0],f=r.frames[0];await library.write('archive',{rolls:[{...r,number:'42',film:'Gold 200',camera:'Kodak H35N'}]});await library.renameRoll(r.id);f=library.archive().rolls[0].frames[0];assert.equal(f.name,'42_Gold200-001.jpg');assert.equal((await fs.readdir(root)).filter(x=>x.endsWith('.jpg')).length,1);
 const edits={turn:1,crop:{x:0,y:0,w:1,h:.5}};await library.saveImage(f.id,edits);let metadata=await sharp(path.join(root,f.path)).metadata();assert.deepEqual([metadata.width,metadata.height],[80,60]);assert.equal((await sharp(await library.bytes(f.id)).metadata()).width,120);
 const again=new Library(path.join(dir,'settings'),library.trash);await again.init();r=again.archive().rolls[0];assert.deepEqual(r.frames[0].edits,edits);const halves=await again.split(f.id,edits);assert.equal(again.archive().rolls[0].frames.length,3);assert.equal((await fs.readdir(root)).filter(x=>x.endsWith('.jpg')).length,3);assert.deepEqual([(await sharp(path.join(root,halves[0].path)).metadata()).width,(await sharp(path.join(root,halves[0].path)).metadata()).height],[40,60]);
 await again.remove(f.id);assert.equal(again.archive().rolls[0].frames.length,2);assert(await fs.stat(path.join(trash,f.name)));await again.bytes(halves[0].id);await again.remove(halves[0].id);assert(await fs.stat(path.join(root,halves[1].path)));
});
test('name collisions, symlink escape, external changes and failed deletion do not overwrite files',async t=>{const {root,library}=await fixture(t);const f=library.archive().rolls[0].frames[0];await fs.copyFile(path.join(root,'scan.jpg'),path.join(root,'taken.jpg'));const renamed=await library.rename(f.id,'taken.jpg');assert.equal(renamed.name,'taken_2.jpg');await fs.appendFile(path.join(root,renamed.path),'external');await assert.rejects(library.saveImage(f.id,{}),/изменён/);library.trash=async()=>{throw Error('denied');};await assert.rejects(library.remove(f.id),/denied/);assert.equal(library.archive().rolls[0].frames.length,1);await assert.rejects(library.disk([...library.catalogs.values()][0],'../escape.jpg'),/путь/);await fs.symlink(path.join(root,'taken.jpg'),path.join(root,'link.jpg'));await assert.rejects(library.disk([...library.catalogs.values()][0],'link.jpg'),/Ссылки/);
});
test('reset renders from original, repeated save does not apply edits twice',async t=>{const {library,root}=await fixture(t);const f=library.archive().rolls[0].frames[0],edits={turn:1};await library.saveImage(f.id,edits);await library.saveImage(f.id,edits);assert.equal((await sharp(path.join(root,f.path)).metadata()).width,80);await library.saveImage(f.id,{});assert.equal((await sharp(path.join(root,f.path)).metadata()).width,120);});

test('straightening saves both 45 degree limits and rejects angles beyond the ruler',async t=>{
 const {library,root}=await fixture(t);const f=library.archive().rolls[0].frames[0];
 for(const angle of [-45,45]){await library.saveImage(f.id,{angle});const metadata=await sharp(path.join(root,f.path)).metadata();assert.deepEqual([metadata.width,metadata.height],[120,80]);assert.equal(library.archive().rolls[0].frames[0].edits.angle,angle);}
 await assert.rejects(library.saveImage(f.id,{angle:45.1}),/угол/);
});

test('disconnect forgets the source while preserving its photos and catalog',async t=>{
 const {library,root,dir}=await fixture(t),source=library.archive().sources[0];
 await library.disconnect(source.id);assert.equal(library.archive().rolls.length,0);assert(await fs.stat(path.join(root,'scan.jpg')));assert(await fs.stat(path.join(root,'.ndzd','catalog.json')));
 const restarted=new Library(path.join(dir,'settings'),library.trash);await restarted.init();assert.equal(restarted.archive().sources.length,0);await restarted.open(root);assert.equal(restarted.archive().rolls[0].frames.length,1);
});

test('upload naming and explicit completion persist across restart',async t=>{
 const {library,root,dir}=await fixture(t);let r=library.archive().rolls[0];
 await library.write('archive',{rolls:[{...r,title:'Лиза',film:'CineStill D',dateStart:'2024-05',completed:true}]});
 await library.renameRoll(r.id,{stem:'ndzd-liza-cinestill-d-2024-001.jpg'});r=library.archive().rolls[0];assert.equal(r.frames[0].name,'ndzd-liza-cinestill-d-2024-001.jpg');assert(await fs.stat(path.join(root,r.frames[0].name)));
 const restarted=new Library(path.join(dir,'settings'),library.trash);await restarted.init();assert.equal(restarted.archive().rolls[0].completed,true);
});
test('uploading an individual JPEG copies only the chosen file into the managed archive',async t=>{
 const {library,root}=await fixture(t);await fs.copyFile(path.join(root,'scan.jpg'),path.join(root,'other.jpg'));
 const result=await library.openPaths([path.join(root,'scan.jpg')]);const added=result.archive.rolls.filter(r=>result.sourceIds.includes(r.sourceId));assert.equal(added.length,1);assert.equal(added[0].frames.length,1);assert.equal(added[0].title,'');assert(await fs.stat(path.join(root,'scan.jpg')));
});

test('upload preview and cancel never register a folder or create its catalog',async t=>{
 const {library,dir}=await fixture(t),root=path.join(dir,'unconfirmed');await fs.mkdir(root);await sharp({create:{width:20,height:20,channels:3,background:'#abc'}}).jpeg().toFile(path.join(root,'photo.jpg'));
 const count=library.archive().rolls.length,preview=await library.prepareUpload([root]);assert.equal(library.archive().rolls.length,count);assert.equal(preview.archive.rolls.length,1);
 await assert.rejects(fs.stat(path.join(root,'.ndzd')),/ENOENT/);await library.bytes(preview.archive.rolls[0].frames[0].id);await library.cancelUpload(preview.token);
 assert.equal(library.archive().rolls.length,count);assert(await fs.stat(path.join(root,'photo.jpg')));
 const restarted=new Library(path.join(dir,'settings'),library.trash);await restarted.init();assert.equal(restarted.archive().rolls.length,count);
});
test('upload commit registers and renames only after explicit confirmation',async t=>{
 const {library,dir}=await fixture(t),root=path.join(dir,'new-folder');await fs.mkdir(root);await sharp({create:{width:20,height:20,channels:3,background:'#abc'}}).jpeg().toFile(path.join(root,'photo.jpg'));
 const preview=await library.prepareUpload([root]),r=preview.archive.rolls[0];await library.commitUpload(preview.token,{...r,title:'Новая съёмка'},'ndzd-new');await library.cancelUpload(preview.token);
 assert.equal(library.archive().rolls.length,2);assert(await fs.stat(path.join(root,'ndzd-new-001.jpg')));assert.equal(library.archive().rolls.find(x=>x.id===r.id).title,'Новая съёмка');
});

test('append previews stay staged and commit into an existing roll only on save',async t=>{
 const {library,root,dir}=await fixture(t),r=library.archive().rolls[0],extra=path.join(dir,'extra.jpg');await fs.copyFile(path.join(root,'scan.jpg'),extra);
 const canceled=await library.prepareUpload([extra]);await library.cancelUpload(canceled.token);assert.equal(library.archive().rolls[0].frames.length,1);assert.deepEqual((await fs.readdir(root)).filter(x=>x.endsWith('.jpg')),['scan.jpg']);
 const first=await library.prepareUpload([extra]),second=await library.prepareUpload([extra]);
 await library.commitUpload(first.token,{...r,title:'Обновлено',frames:[...r.frames,...first.archive.rolls[0].frames,...second.archive.rolls[0].frames]},'new');
 await library.cancelUpload(first.token);await library.cancelUpload(second.token);
 const saved=library.archive().rolls[0];assert.equal(saved.frames.length,3);assert.equal(saved.title,'Обновлено');assert.equal(library.archive().rolls.length,1);
 for(const f of saved.frames){assert(await fs.stat(path.join(root,f.path)));await library.bytes(f.id);}
});

test('thumbnail is bounded and preserves the original file',async t=>{
 const {library,root}=await fixture(t);await sharp({create:{width:3600,height:2400,channels:3,background:'#abc'}}).jpeg().toFile(path.join(root,'scan.jpg'));await library.open(root);
 const frame=library.archive().rolls[0].frames[0],before=await fs.readFile(path.join(root,'scan.jpg')),preview=await library.thumbnail(frame.id),meta=await sharp(preview).metadata();
 assert.deepEqual([meta.width,meta.height],[600,400]);assert.deepEqual(await fs.readFile(path.join(root,'scan.jpg')),before);assert(preview.length<before.length);
});


test('new naming keeps sequences after deletion, halves and reload; folder rename preserves paths',async t=>{
 const {library,root,dir}=await fixture(t);await fs.copyFile(path.join(root,'scan.jpg'),path.join(root,'scan2.jpg'));await library.open(root);
 let r=library.archive().rolls[0];await library.write('archive',{rolls:[{...r,title:'Питер',number:'42',film:'Kodak Gold',iso:'200',frameFormat:'Полукадр'}]});
 await library.renameRoll(r.id,{stem:'ndzd-piter',renameFolder:true});let source=library.archive().sources[0];r=library.archive().rolls[0];assert.equal(path.basename(source.root),'042 — Kodak Gold 200 — Питер');
 assert.deepEqual(r.frames.map(f=>f.name),['ndzd-piter-001.jpg','ndzd-piter-002.jpg']);
 const halves=await library.split(r.frames[1].id,{});assert.deepEqual(halves.map(f=>f.name),['ndzd-piter-002-l.jpg','ndzd-piter-002-r.jpg']);
 await library.remove(r.frames[0].id);await library.renameRoll(r.id,{stem:'ndzd-piter'});r=library.archive().rolls[0];assert.deepEqual(r.frames.map(f=>f.name),['ndzd-piter-002.jpg','ndzd-piter-002-l.jpg','ndzd-piter-002-r.jpg']);
 const extra=path.join(dir,'foreign.jpg');await fs.copyFile(path.join(source.root,r.frames[0].path),extra);const before=await fs.readFile(extra),preview=await library.prepareUpload([extra]);
 await library.commitUpload(preview.token,{...r,namingVersion:2,frames:[...r.frames,...preview.archive.rolls[0].frames]},'ndzd-piter');await library.cancelUpload(preview.token);
 r=library.archive().rolls[0];assert.equal(r.frames.at(-1).name,'ndzd-piter-003.jpg');assert.deepEqual(await fs.readFile(extra),before);
 const restarted=new Library(path.join(dir,'settings'),library.trash);await restarted.init();assert.equal(restarted.archive().rolls[0].frames.length,4);for(const f of r.frames)await restarted.bytes(f.id);
});


test('macOS decomposed Cyrillic folder names are readable after rename and restart',async t=>{
 const {library,root,dir}=await fixture(t);let r=library.archive().rolls[0];
 await library.write('archive',{rolls:[{...r,title:'горный алтай',number:'1',film:'Kodak Vision',iso:'200'}]});
 await library.renameRoll(r.id,{stem:'ndzd-gornyy-altay',renameFolder:true});
 const c=[...library.catalogs.values()][0];assert.equal(c.root,await fs.realpath(c.root));
 const frame=library.archive().rolls[0].frames[0];await library.bytes(frame.id);await library.thumbnail(frame.id);await library.saveImage(frame.id,{turn:1});
 // Catalogs made by 0.3.0 may still hold a composed path until the next restart.
 const actual=c.root;c.root=c.root.normalize('NFC');await library.bytes(frame.id);await library.thumbnail(frame.id);c.root=actual;
 const restarted=new Library(path.join(dir,'settings'),library.trash);await restarted.init();await restarted.bytes(frame.id);assert.equal(restarted.archive().rolls[0].frames[0].name,'ndzd-gornyy-altay-001.jpg');
 const link=path.join(c.root,'link.jpg');await fs.symlink(path.join(c.root,frame.path),link);await assert.rejects(library.disk(c,'link.jpg'),/Ссылки/);
});
