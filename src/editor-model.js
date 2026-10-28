export const trashedFrames = roll => (roll?.frames || []).filter(f=>f.deleted&&!f.splitHidden);
export const restoreSelectedFrames = (roll, ids) => roll.frames.map(f=>f.deleted&&!f.splitHidden&&ids.has(f.id)?{...f,deleted:false}:f);
export const activeFrames = roll => (roll?.frames || []).filter(f=>!f.deleted&&!f.splitHidden);
export const canSplit = roll => roll?.frameFormat ? roll.frameFormat==='Полукадр' : /^kodak\s+h35n$/i.test(roll?.camera?.trim()||'');
export const scanCount = roll => new Set(activeFrames(roll).map(f=>f.sourceFrameId||f.id)).size;
export const fullCrop = () => ({x:0,y:0,w:1,h:1});
export function safeCrop(c={}) {
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
  const x=clamp(c.x??0,0,.98),y=clamp(c.y??0,0,.98);
  return {x,y,w:clamp(c.w??1,.02,1-x),h:clamp(c.h??1,.02,1-y)};
}
export function splitRegions(direction,boundary,gap,width,height) {
  const size=direction==='horizontal'?height:width;
  if(!(size>0))throw new Error('Не удалось определить размер скана');
  const center=Number(boundary)/100,g=Number(gap)/size;
  if(!Number.isFinite(center)||!Number.isFinite(g)||g<0||center-g/2<=0||center+g/2>=1)throw new Error('Уменьшите промежуток или сдвиньте границу ближе к центру');
  return direction==='horizontal'?[{x:0,y:0,w:1,h:center-g/2},{x:0,y:center+g/2,w:1,h:1-center-g/2}]:[{x:0,y:0,w:center-g/2,h:1},{x:center+g/2,y:0,w:1-center-g/2,h:1}];
}
export function splitFrame(frame,regions,makeId) {
  if(frame.sourceFrameId||frame.splitHidden)throw new Error('Этот скан уже разделён');
  return regions.map((region,i)=>({...frame,id:makeId(),sourceFrameId:frame.id,region,name:frame.name.replace(/\.jpe?g$/i,'')+'-'+(i?'r':'l')+'.jpg',viewed:false,rating:0,favorite:false,deleted:false,splitHidden:false,edits:undefined,persisted:false}));
}

export function hasEdits(frame) {
  const edits=frame?.edits||{},crop=safeCrop(edits.crop);
  return !!((edits.turn||0)%4 || edits.angle || crop.x || crop.y || Math.abs(crop.w-1)>.00001 || Math.abs(crop.h-1)>.00001);
}
export function rotateEdits(edits={},direction=1) {
  const c=safeCrop(edits.crop),clockwise=direction>0;
  const crop=clockwise?{x:1-c.y-c.h,y:c.x,w:c.h,h:c.w}:{x:c.y,y:1-c.x-c.w,w:c.h,h:c.w};
  const reciprocal=1/Number(edits.aspect);
  const ratios=['1','1.5','0.6666666667','1.3333333333','0.75','1.7777777778','0.5625'];
  const aspect=edits.aspect&& !['original','free'].includes(edits.aspect)?(ratios.find(r=>Math.abs(Number(r)-reciprocal)<.00001)||String(reciprocal)):edits.aspect;
  return {...edits,turn:((edits.turn||0)+(clockwise?1:3))%4,crop:safeCrop(crop),aspect};
}
export function createHistory(limit=30) {
  const histories=new Map();
  const state=key=>{if(!histories.has(key))histories.set(key,{past:[],future:[]});return histories.get(key);};
  const copy=value=>structuredClone(value);
  return {
    clear(key){histories.delete(key);},
    remember(key,value){const h=state(key);h.past.push(copy(value));if(h.past.length>limit)h.past.shift();h.future=[];},
    undo(key,value){const h=state(key);if(!h.past.length)return null;h.future.push(copy(value));return h.past.pop();},
    redo(key,value){const h=state(key);if(!h.future.length)return null;h.past.push(copy(value));return h.future.pop();},
    canUndo:key=>!!state(key).past.length,canRedo:key=>!!state(key).future.length,
  };
}

export function canCompare(frame) {
 const edits=frame?.edits||{},c=safeCrop(edits.crop);
 return !!(edits.angle||c.x||c.y||Math.abs(c.w-1)>.00001||Math.abs(c.h-1)>.00001);
}
export const comparisonOriginal = frame => ({...frame,edits:{turn:frame.edits?.turn||0}});
