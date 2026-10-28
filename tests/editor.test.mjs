import test from 'node:test';
import assert from 'node:assert/strict';
import {activeFrames,canSplit,scanCount,safeCrop,splitRegions,splitFrame} from '../src/editor-model.js';
import {filterFrames,filterRolls} from '../src/model.js';
test('Split is available only for Kodak H35N, independent of film brand',()=>{
 assert.ok(canSplit({camera:'Kodak H35N'}));assert.ok(!canSplit({camera:'Contax T2',film:'Kodak Gold'}));assert.ok(!canSplit({}));
});
test('Split removes a pixel gap from both sides and preserves the source',()=>{
 const source={id:'scan',name:'042.jpg',rating:3,viewed:true,persisted:true,edits:{turn:1}};
 const regions=splitRegions('vertical',50,24,2400,1600);
 assert.equal(regions[0].w,.495);assert.equal(regions[1].x,.505);
 let n=0;const halves=splitFrame(source,regions,()=>String(++n));
 assert.equal(source.rating,3);assert.equal(halves[0].sourceFrameId,'scan');assert.equal(halves[0].name,'042-l.jpg');
 assert.equal(halves[1].name,'042-r.jpg');assert.equal(halves[0].rating,0);assert.equal(halves[0].viewed,false);assert.equal(halves[0].edits,undefined);
 halves[0].rating=2;assert.equal(halves[1].rating,0);
 const roll={frames:[{...source,splitHidden:true},...halves]};assert.equal(activeFrames(roll).length,2);assert.equal(scanCount(roll),1);
 halves[0].deleted=true;assert.equal(scanCount(roll),1);assert.equal(activeFrames(roll).length,1);assert.equal(roll.frames.length,3);
 assert.throws(()=>splitFrame(halves[1],regions,()=>''));
});
test('Horizontal split and invalid boundary/gap handling',()=>{
 const r=splitRegions('horizontal',40,20,3000,2000);assert.equal(r[0].h,.395);assert.equal(r[1].y,.405);
 assert.throws(()=>splitRegions('vertical',5,1000,1000,1000));assert.throws(()=>splitRegions('vertical',50,-1,1000,1000));
});
test('Crop stays inside image; deleted and hidden scans do not appear in filters',()=>{
 assert.deepEqual(safeCrop({x:.9,y:-1,w:2,h:1}),{x:.9,y:0,w:1-.9,h:1});
 const frames=[{id:'a',name:'a.jpg',viewed:true},{id:'b',name:'b.jpg',deleted:true},{id:'c',name:'c.jpg',splitHidden:true}];
 assert.equal(filterFrames(frames).length,1);assert.equal(filterRolls([{frames}],{incomplete:true}).length,1);assert.equal(filterRolls([{frames,completed:true}],{incomplete:true}).length,0);
});

test('Clockwise and counterclockwise rotation preserve crop and invert aspect',async()=>{
 const {rotateEdits,hasEdits}=await import('../src/editor-model.js');
 const edits={turn:0,crop:{x:.1,y:.2,w:.3,h:.4},aspect:'1.5',angle:1.2};
 const cw=rotateEdits(edits,1);assert.equal(cw.turn,1);assert.equal(cw.aspect,'0.6666666667');
 assert.ok(Math.abs(cw.crop.x-.4)<1e-9);assert.equal(cw.crop.y,.1);
 const back=rotateEdits(cw,-1);assert.equal(back.turn,0);assert.equal(back.aspect,'1.5');
 for(const key of ['x','y','w','h'])assert.ok(Math.abs(back.crop[key]-edits.crop[key])<1e-9);
 assert.equal(rotateEdits({},-1).turn,3);assert.ok(!hasEdits({edits:{turn:0,angle:0,aspect:'original'}}));assert.ok(hasEdits({edits:{turn:1}}));
});
test('History supports repeated undo/redo and clears redo after a new action',async()=>{
 const {createHistory}=await import('../src/editor-model.js');const h=createHistory();
 h.remember('film',{value:0});h.remember('film',{value:1});
 assert.deepEqual(h.undo('film',{value:2}),{value:1});assert.deepEqual(h.undo('film',{value:1}),{value:0});
 assert.deepEqual(h.redo('film',{value:0}),{value:1});assert.deepEqual(h.redo('film',{value:1}),{value:2});
 h.undo('film',{value:2});h.remember('film',{value:1});assert.equal(h.canRedo('film'),false);assert.equal(h.canUndo('other'),false);
 const original={frames:[{rating:1}]};h.remember('copy',original);original.frames[0].rating=3;assert.equal(h.undo('copy',original).frames[0].rating,1);
});

test('Trash restores only selected photos and preserves independent half-frame metadata',async()=>{
 const {trashedFrames,restoreSelectedFrames}=await import('../src/editor-model.js');
 const half={id:'a',sourceFrameId:'scan',deleted:true,rating:3,edits:{turn:1},region:{x:0,y:0,w:.5,h:1}};
 const roll={frames:[{id:'scan',splitHidden:true,deleted:true},half,{...half,id:'b',rating:1},{id:'live',deleted:false}]};
 const frames=restoreSelectedFrames(roll,new Set(['a','scan','live','missing']));
 assert.deepEqual(trashedFrames({frames}).map(f=>f.id),['b']);
 assert.deepEqual(frames[1],{...half,deleted:false});
 assert.equal(roll.frames[1].deleted,true);
 assert.equal(frames[0].deleted,true);
 assert.deepEqual(activeFrames({frames}).map(f=>f.id),['a','live']);
});

test('Centered split keeps original followed by independent left and right photos',()=>{
 const source={id:'scan',name:'06.jpg',favorite:true};let n=0;
 const halves=splitFrame(source,[{x:0,y:0,w:.5,h:1},{x:.5,y:0,w:.5,h:1}],()=>String(++n));
 const r={frames:[source,...halves]};
 assert.deepEqual(activeFrames(r).map(f=>f.name),['06.jpg','06-l.jpg','06-r.jpg']);
 assert.equal(halves[0].favorite,false);halves[1].favorite=true;
 assert.deepEqual(filterFrames(r.frames,{favorites:true}).map(f=>f.id),['scan','2']);
});

test('Comparison excludes quarter turns and keeps orientation in the original',async()=>{
 const {canCompare,comparisonOriginal}=await import('../src/editor-model.js');
 assert.equal(canCompare({edits:{turn:1}}),false);
 assert.equal(canCompare({edits:{turn:3,crop:{x:0,y:0,w:1,h:1}}}),false);
 assert.equal(canCompare({edits:{angle:.1}}),true);
 const f={id:'half',region:{x:.5,y:0,w:.5,h:1},edits:{turn:1,crop:{x:.1,y:0,w:.8,h:1},angle:2}};
 assert.equal(canCompare(f),true);
 assert.deepEqual(comparisonOriginal(f),{...f,edits:{turn:1}});
 assert.equal(f.edits.angle,2);
});

test('frame format overrides legacy camera and file histories are independent',async()=>{
 const {createHistory}=await import('../src/editor-model.js');
 assert(canSplit({frameFormat:'Полукадр'}));assert(!canSplit({frameFormat:'Полный кадр',camera:'Kodak H35N'}));
 const h=createHistory();h.remember('photo1',{edits:{}});h.undo('photo1',{edits:{turn:1}});assert(h.canRedo('photo1'));assert(!h.canRedo('photo2'));h.remember('photo2',{edits:{}});assert(h.canRedo('photo1'));
});
