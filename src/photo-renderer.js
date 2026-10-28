import {safeCrop} from './editor-model.js';
const decoded=new Map();
export async function sourceImage(frame,getFile) {
  const key=frame.sourceFrameId||frame.id;
  if(!decoded.has(key))decoded.set(key,(async()=>{
    const file=await getFile(key);const url=file?URL.createObjectURL(file):frame.demoUrl;
    if(!url)throw new Error('Фотография недоступна. Подключите папку снова.');
    const image=new Image();image.src=url;
    try{await image.decode();return image;}finally{if(file)URL.revokeObjectURL(url);}
  })().catch(error=>{decoded.delete(key);throw error;}));
  // Keep the decode cache bounded for large film archives.
  if(decoded.size>12)decoded.delete(decoded.keys().next().value);
  return decoded.get(key);
}
function canvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c;}
export async function renderPhoto(frame,getFile,{uncropped=false,original=false,unmodified=false,maxSize=1800,image:providedImage}={}) {
  const image=providedImage||await sourceImage(frame,getFile),r=original?{x:0,y:0,w:1,h:1}:safeCrop(frame.region);
  const sw=(image.naturalWidth||image.width)*r.w,sh=(image.naturalHeight||image.height)*r.h,scale=Math.min(1,maxSize/Math.max(sw,sh));
  const base=canvas(sw*scale,sh*scale);base.getContext('2d').drawImage(image,r.x*(image.naturalWidth||image.width),r.y*(image.naturalHeight||image.height),sw,sh,0,0,base.width,base.height);
  if(original)return base;
  const edits=unmodified?{}:frame.edits||{},turn=((edits.turn||0)%4+4)%4;
  const rotated=canvas(turn%2?base.height:base.width,turn%2?base.width:base.height),ctx=rotated.getContext('2d');
  ctx.translate(rotated.width/2,rotated.height/2);ctx.rotate(turn*Math.PI/2);ctx.drawImage(base,-base.width/2,-base.height/2);
  const angle=(edits.angle||0)*Math.PI/180;
  let straight=rotated;
  if(angle){straight=canvas(rotated.width,rotated.height);const c=straight.getContext('2d'),w=rotated.width,h=rotated.height,s=Math.max(Math.abs(Math.cos(angle))+h/w*Math.abs(Math.sin(angle)),Math.abs(Math.cos(angle))+w/h*Math.abs(Math.sin(angle)));c.translate(w/2,h/2);c.rotate(angle);c.scale(s,s);c.drawImage(rotated,-w/2,-h/2);}
  if(uncropped)return straight;
  const crop=safeCrop(edits.crop),out=canvas(straight.width*crop.w,straight.height*crop.h);
  out.getContext('2d').drawImage(straight,crop.x*straight.width,crop.y*straight.height,crop.w*straight.width,crop.h*straight.height,0,0,out.width,out.height);
  return out;
}
