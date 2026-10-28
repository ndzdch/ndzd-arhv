import test from 'node:test';
import assert from 'node:assert/strict';
import {groupFiles,filterFrames,filterRolls,selectFrame,pruneSelection,plural,appendPhotos} from '../src/model.js';
const source={id:'root1',name:'Архив'};
const entry=path=>({path,name:path.split('/').pop(),size:123,modified:12});
test('Archive search covers every description field and combines words across fields',()=>{
 const r={title:'Поездка',film:'Kodak Portra 400',iso:'800',camera:'Contax T2',date:'1–15 мая 2026',description:'Озёра и лес',folder:'',frames:[]};
 for(const query of ['поездка','portra','800','contax','t2','мая','2026','озера','contax 800 мая'])assert.equal(filterRolls([r],{query}).length,1,query);
 assert.equal(filterRolls([r],{query:'kodak h35n'}).length,0);
 assert.equal(filterRolls([r],{period:'2026'}).length,1);
});
test('JPEG in root and nested folders form separate rolls; filenames use natural ordering',()=>{
 const rolls=groupFiles(['root.jpg','042/scan10.JPG','042/scan2.jpeg','042/notes.txt','042/sub/a.jpg','empty/image.png'].map(entry),source);
 assert.equal(rolls.length,3);
 assert.equal(rolls[0].title,'Архив');
 assert.deepEqual(rolls[1].frames.map(f=>f.name),['scan2.jpeg','scan10.JPG']);
 assert.equal(rolls[1].number,'042');
 assert.equal(rolls[2].folder,'042/sub');
});
test('Refresh keeps metadata and removes missing files without merging equal filenames across folders',()=>{
 const before=groupFiles(['042/a.jpg','042/b.jpg','043/a.jpg'].map(entry),source);
 before[0].title='Тбилиси';before[0].frames[0].rating=3;before[0].frames[0].viewed=true;
 const after=groupFiles(['042/a.jpg','042/new.jpg','043/a.jpg'].map(entry),source,before);
 assert.equal(after[0].title,'Тбилиси');assert.equal(after[0].frames[0].rating,3);
 assert.equal(after[1].frames[0].rating,0);
 assert.deepEqual([...pruneSelection(new Set(['root1/042/a.jpg','root1/042/b.jpg']),after)],['root1/042/a.jpg']);
});
test('Filters combine, and viewed status is independent from rating',()=>{
 const frames=[{name:'one.jpg',rating:3,viewed:false},{name:'two.jpg',rating:3,viewed:true}];
 assert.equal(filterFrames(frames,{unseen:true,rating:'3'}).length,1);
 const rolls=[{title:'Тбилиси',number:'042',film:'Gold',date:'2026-05',frames,description:'май',folder:'042'}];
 assert.equal(filterRolls(rolls,{query:'тБи',film:'Gold',period:'2026',incomplete:true}).length,1);
 assert.equal(filterRolls(rolls,{query:'Москва'}).length,0);
});
test('Shift range works both ways and retains selected frames outside current filter',()=>{
 const selected=selectFrame(new Set(['hidden']),'b',['a','b','c','d'],'d',true);
 assert.deepEqual([...selected],['hidden','b','c','d']);
 assert.deepEqual([...selectFrame(selected,'c',['b','c','d'],'',false)],['hidden','b','d']);
});
test('Russian counts cover teens and large numbers',()=>{
 const forms=['кадр','кадра','кадров'];
 assert.equal(plural(21,forms),'21 кадр');assert.equal(plural(14,forms),'14 кадров');assert.equal(plural(32,forms),'32 кадра');
});
test('Appending photos skips repeat selections and preserves different files with the same name',()=>{
 const roll={id:'film/1',frames:[{id:'existing',name:'one.jpg',size:100,modified:1,rating:3}]};
 let id=0;
 const added=appendPhotos(roll,[{name:'one.jpg',size:100,modified:1},{name:'one.jpg',size:200,modified:2},{name:'two.JPG',size:300,modified:3},{name:'two.JPG',size:300,modified:3},{name:'notes.txt',size:10,modified:4}],()=>String(++id));
 assert.equal(added.length,2);assert.equal(new Set(added.map(f=>f.id)).size,2);
 assert.equal(roll.frames[0].rating,3);assert.equal(roll.frames.length,1);
 assert.ok(added.every(f=>f.persisted&&!f.viewed&&f.rating===0));
});

test('viewing every photo never completes a roll; only explicit completion changes status and filter',async()=>{
 const {rollStatus}=await import('../src/model.js');const r={id:'a',frames:[{id:'f',viewed:true}]};
 assert.deepEqual(rollStatus(r),['new','Не разобрана']);assert.equal(filterRolls([r],{incomplete:true}).length,1);r.workStarted=true;assert.deepEqual(rollStatus(r),['working','В работе']);
 r.completed=true;assert.deepEqual(rollStatus(r),['done','Готово']);assert.equal(filterRolls([r],{incomplete:true}).length,0);
});

test('photo actions start work while opening or viewing does not',async()=>{const {rollStatus}=await import('../src/model.js');assert.equal(rollStatus({frames:[{viewed:true,edits:{}}]})[0],'new');for(const f of [{favorite:true},{deleted:true},{edits:{angle:1}},{edits:{turn:1}}])assert.equal(rollStatus({frames:[f]})[0],'working');});
