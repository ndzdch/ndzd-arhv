import {renderPhoto} from './photo-renderer.js';

// Decode only two photos at a time so large scans cannot exhaust image memory.
export function createThumbnails(getFile,{size=600,limit=150,concurrency=2}={}) {
 const cache=new Map(),ready=new Set(),resolved=new Map(),queue=[];let running=0,revision=0;
 function pump(){while(running<concurrency&&queue.length){const task=queue.shift();running++;task().finally(()=>{running--;pump();});}}
 function trim(){while(ready.size>limit){const oldest=ready.values().next().value;ready.delete(oldest);cache.get(oldest)?.then(url=>{if(url)URL.revokeObjectURL(url);},()=>{});cache.delete(oldest);resolved.delete(oldest);}}
 function get(frame,isNeeded=()=>true){
  const key=frame.id+JSON.stringify(frame.edits||{})+JSON.stringify(frame.region||{});
  if(cache.has(key))return cache.get(key);
  const generation=revision;
  const result=new Promise((resolve,reject)=>{queue.push(async()=>{
   let bitmap;
   try{
    if(generation!==revision||!isNeeded()){if(generation===revision)cache.delete(key);resolve(null);return;}
    const file=await getFile(frame.sourceFrameId||frame.id);
    if(!file)throw Error('Фотография недоступна');
    bitmap=await createImageBitmap(file,{resizeWidth:size,resizeQuality:'high',imageOrientation:'from-image'});
    const canvas=await renderPhoto(frame,null,{maxSize:size,image:bitmap});
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Не удалось создать превью')),'image/jpeg',.85));
    if(generation!==revision||cache.get(key)!==result){resolve(null);return;}
    const url=URL.createObjectURL(blob);resolved.set(key,url);ready.add(key);resolve(url);setTimeout(trim,0);
   }catch(error){if(generation===revision){cache.delete(key);ready.delete(key);}reject(error);}finally{bitmap?.close();}
  });});cache.set(key,result);pump();
  return result;
 }
 function clear(){revision++;for(const value of cache.values())value.then(url=>{if(url)URL.revokeObjectURL(url);},()=>{});cache.clear();ready.clear();resolved.clear();}
 function evict(id){for(const [key,value] of cache){if(!key.startsWith(id+'{'))continue;value.then(url=>{if(url)URL.revokeObjectURL(url);},()=>{});cache.delete(key);ready.delete(key);resolved.delete(key);}}
 return {get,clear,evict,peek:frame=>resolved.get(frame.id+JSON.stringify(frame.edits||{})+JSON.stringify(frame.region||{}))};
}
