// Animate a single live header; labels keep their final size throughout the reveal.
export function createMotion(root){
 let animations=[];
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 const play=(node,frames,options)=>{const a=node.animate(frames,options);animations.push(a);a.finished.catch(()=>{}).finally(()=>a.cancel());return a;};
 function capture({album=false}={}){
  const frames=new Map();if(album)root.querySelectorAll('.album-frame').forEach(node=>frames.set(node.querySelector('[data-frame]').dataset.frame,{node,rect:node.getBoundingClientRect()}));
  for(const a of animations)a.cancel();animations=[];
  const brand=root.querySelector('header .archive-brand');
  return {frames,brand,width:brand?.getBoundingClientRect().width,tabs:[...root.querySelectorAll('.archive-category .button')].map(b=>b.classList.contains('active'))};
 }
 function header(before,page,previous){
  const brand=root.querySelector('header .archive-brand'),header=brand?.closest('header');
  if(!brand||!header)return;
  if(before.brand)brand.replaceWith(before.brand);
  const live=header.querySelector('.archive-brand');
  const red=document.createElement('span');red.className='header-red';red.setAttribute('aria-hidden','true');header.prepend(red);
  const width=live.getBoundingClientRect().width;
  const tabs=[...header.querySelectorAll('.archive-category .button')];
  tabs.forEach((button,i)=>{const fill=document.createElement('span');fill.className='archive-tab-fill';fill.setAttribute('aria-hidden','true');button.prepend(fill);
   const selected=button.classList.contains('active');
   if(page===previous&&!reduced()&&before.tabs?.length===2&&before.tabs[i]!==selected){
    const backwards=tabs[0].classList.contains('active');
    play(fill,[{transform:'scaleX(1)',clipPath:selected?(backwards?'inset(0 0 0 100%)':'inset(0 100% 0 0)'):'inset(0 0 0 0)'},{transform:'scaleX(1)',clipPath:selected?'inset(0 0 0 0)':(backwards?'inset(0 100% 0 0)':'inset(0 0 0 100%)')}],{duration:selected?320:190,delay:selected?190:0,fill:'both',easing:'cubic-bezier(.25,.1,.25,1)'});
   }
  });
  if(page===previous||reduced())return;
  if(before.width&&Math.abs(before.width-width)>1)play(red,[{width:before.width+'px'},{width:width+'px'}],{duration:420,easing:'cubic-bezier(.22,1,.36,1)'});
  const controls=header.querySelector('.header-controls');
  if(controls)play(controls,[{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)'}],{duration:420,easing:'cubic-bezier(.22,1,.36,1)'});
 }
 function screen(page,previous){
  if(page===previous||reduced())return;
  const content=root.querySelector('.upload-layout, .editor-body, main');
  if(content)play(content,[{opacity:0},{opacity:1}],{duration:page==='roll'?480:320,easing:'ease-in-out'});
 }
 function photos(){
  if(reduced())return;
  root.querySelectorAll('.album-frame').forEach((frame,index)=>{
   const img=frame.querySelector('img[data-photo]');let started=false,timer;
   frame.style.opacity='0';
   const reveal=()=>{if(started)return;started=true;clearTimeout(timer);if(!frame.isConnected)return;
    const entrance=frame.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:600,delay:Math.min(index,8)*35,easing:'cubic-bezier(.25,.1,.25,1)',fill:'both'});entrance.finished.catch(()=>{}).finally(()=>{frame.style.opacity='';entrance.cancel();});
   };
   if(img?.complete&&img.naturalWidth)reveal();else{img?.addEventListener('load',reveal,{once:true});img?.addEventListener('error',reveal,{once:true});img?.addEventListener('photo-ready',reveal,{once:true});timer=setTimeout(reveal,1200);}
  });
 }
 function reflow(before){if(reduced())return;for(const {node,rect} of before.frames.values()){if(!node.isConnected)continue;const next=node.getBoundingClientRect(),x=rect.x-next.x,y=rect.y-next.y;if(Math.abs(x)+Math.abs(y)<1)continue;play(node,[{transform:`translate(${x}px,${y}px)`},{transform:'translate(0,0)'}],{duration:440,easing:'cubic-bezier(.25,.1,.25,1)'});}}
 return {capture,header,screen,photos,reflow};
}
