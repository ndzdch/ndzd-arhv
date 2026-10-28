import {activeFrames,hasEdits,canSplit,safeCrop,splitRegions,splitFrame,canCompare,comparisonOriginal,rotateEdits,createHistory} from './editor-model.js';
import {sourceImage,renderPhoto} from './photo-renderer.js';
import {read,write} from './storage.js';

export function createEditor({root,button,e,getRoll,getFile,save,navigate,rerender,selection,toast,imageMarkup,desktop}) {
  let immersive=false,angleGrid=false,sideBySide=false,favoritePulse=false,cropBaseline=null,cropSnapshot=null;
  let frameId='',mode='viewer',background='white',original=false,wholeScan=false,cropping=false,zoom='fit',pan={x:0,y:0},panDrag=null,suppressClick=false,photoSize=null,zoomTimer,cropUpdate=Promise.resolve(),split={direction:'vertical',boundary:50,gap:24},drawVersion=0,drag=null,aspect='',working=false;
  const iconAssets={'editor-rotate:-1':'imgGroup12','editor-rotate:1':'imgGroup13','editor-crop':'imgVector88','editor-favorite':'imgVector','editor-undo':'imgGroup15','editor-redo':'imgGroup16','editor-fullscreen':'imgGroup10','editor-compare':'imgRectangle56'};
  const textButton=button;
  button=(label,action='',variant='',attrs='')=>{
    const key=action==='editor-rotate'?action+':'+(attrs.includes('value="-1"')?'-1':'1'):action;
    if(action==='editor-crop')return textButton('',action,variant,attrs).replace('</button>','<span class="crop-state-window"><span class="crop-stretch"><span class="crop-start"><img class="crop-rest" src="./prototype-assets/editor/crop-rest.svg" alt=""></span><span class="crop-middle"><img src="./prototype-assets/editor/crop-hover.svg" alt=""></span><span class="crop-end"><img src="./prototype-assets/editor/crop-hover.svg" alt=""></span></span><img class="crop-active" src="./prototype-assets/editor/crop-active.svg" alt=""></span></button>');
    if(action==='editor-fullscreen')return textButton('',action,variant,attrs).replace('</button>','<span class="fullscreen-state"><img class="fullscreen-fixed nw" src="./prototype-assets/editor/imgGroup10.svg" alt=""><img class="fullscreen-fixed se" src="./prototype-assets/editor/imgGroup10.svg" alt=""><img class="fullscreen-moving ne" src="./prototype-assets/editor/fullscreen-hover.svg" alt=""><img class="fullscreen-moving sw" src="./prototype-assets/editor/fullscreen-hover.svg" alt=""></span></button>');
    if(action==='editor-original')return textButton('',action,variant,attrs).replace('</button>','<span class="original-compare-icon" aria-hidden="true"></span></button>');
    const asset=action==='editor-favorite'?(attrs.includes('aria-pressed="true"')?'imgVector':'heart-outline'):iconAssets[key];
    const html=textButton(asset?'':label,action,variant,attrs);
    return asset?html.replace('</button>',`<img class="editor-tool-icon" src="./prototype-assets/editor/${asset}.svg" alt=""></button>`):html;
  };
  const aspectOptions=[['original','Оригинал'],['free','Свободно'],['1','1:1'],['0.6666666667','2:3'],['1.5','3:2'],['0.75','3:4'],['1.3333333333','4:3'],['0.5625','9:16'],['1.7777777778','16:9']];
  const history=createHistory();
  read('editor-background-v2').then(value=>{if(['white','gray','black'].includes(value)){background=value;if(root.querySelector('.editor'))rerender();}}).catch(()=>{});
  const frame=()=>getRoll()?.frames.find(f=>f.id===frameId);
  const snapshot=()=>{const f=frame();return {edits:structuredClone(f?.edits||{}),favorite:!!f?.favorite,rating:f?.rating||0};};
  const cropChanged=()=>cropping&&cropSnapshot&&JSON.stringify(snapshot().edits)!==JSON.stringify(cropSnapshot.edits);
  function commitCrop(){if(cropChanged()){history.remember(frameId,cropSnapshot);getRoll().workStarted=true;}cropping=false;cropSnapshot=null;cropBaseline=null;}
  function updateHistory(){const reset=root.querySelector('[data-action="editor-reset"]');if(reset)reset.disabled=!hasEdits(frame());for(const action of ['undo','redo']){const b=root.querySelector('[data-action="editor-'+action+'"]');if(b)b.disabled=!(action==='undo'?(history.canUndo(frameId)||cropChanged()):history.canRedo(frameId));}}
  function remember(){getRoll().workStarted=true;if(!cropping)history.remember(frameId,snapshot());updateHistory();}
  async function persist(){await save();}
  function enter(nextMode,id){if(cropping&&frameId){commitCrop();persist();}stopAngleMotion();clearTimeout(angleSaveTimer);mode='viewer';cropping=nextMode==='crop';frameId=id;angleGrid=false;sideBySide=false;original=false;wholeScan=false;zoom='fit';pan={x:0,y:0};drag=null;panDrag=null;aspect=frame()?.edits?.aspect||'original';clearTimeout(zoomTimer);photoSize=null;suppressClick=false;const f=frame();if(!f)return;cropBaseline=cropping?structuredClone(f.edits||{}):null;cropSnapshot=cropping?snapshot():null;if(mode==='split'&&(!canSplit(getRoll())||f.sourceFrameId||f.splitHidden)){mode='viewer';navigate('viewer',f.id);return;}if(!f.viewed){f.viewed=true;persist();}getRoll().lastFrameId=f.id;persist();}
  const angleSpacing=6;
  const range=(label,name,min,max,value,step=1)=>`<label class="editor-field angle-control ${Number(value)!==0?'is-adjusted':''}" style="--angle-offset:${-Number(value)*angleSpacing}px"><span class="angle-label">${label}</span><output data-output="${name}">${e(value)}</output><span class="angle-ruler-window" aria-hidden="true"><span class="angle-tape">${Array.from({length:91},(_,i)=>{const degree=i-45;return `<i class="angle-tick ${degree===0?'zero':degree%10===0?'major':''}" data-degree="${degree}" style="left:${degree*angleSpacing}px"></i>`;}).join('')}</span></span><input type="range" data-edit="${name}" min="${min}" max="${max}" step="${step}" value="${e(value)}" aria-label="${label}"></label>`;
  function paintAngle(input,value){
    const control=input.closest('.angle-control');control.style.setProperty('--angle-offset',(-value*angleSpacing)+'px');control.classList.toggle('is-adjusted',Number(value)!==0);
  }

  function markup(){
    const r=getRoll(),f=frame();if(!f)return '';
    const list=activeFrames(r),index=list.findIndex(item=>item.id===f.id),group=list.filter(item=>selection().has(item.id)&&!item.sourceFrameId);
    const theme=`<div class="photo-colors" role="group" aria-label="Фон">${[['white','Белый'],['gray','Серый'],['black','Чёрный']].map(([v,label])=>button('','editor-background','color-circle '+v,`data-value="${v}" aria-label="${label}" title="${label}" aria-pressed="${background===v}"`)).join('')}</div>`;
    const tools=`<div class="editor-rotation"><span>Поворот</span><div>${button('↺','editor-rotate','', 'data-value="-1" aria-label="Повернуть против часовой стрелки на 90°"')}${button('↻','editor-rotate','', 'data-value="1" aria-label="Повернуть по часовой стрелке на 90°"')}</div></div>${canSplit(r)&&!f.sourceFrameId?button('Разделить кадр','editor-split','',r.frames.some(x=>x.sourceFrameId===f.id)?'disabled title="Скан уже разделён"':''):''}<div class="crop-controls">${button('⌗','editor-crop','icon-button crop-icon',`aria-label="Кадрирование" aria-pressed="${cropping}" title="Кадрирование"`)}<div class="aspect-picker">${button(aspectOptions.find(x=>x[0]===aspect)?.[1]||'Оригинал','editor-aspect-menu','aspect-trigger','aria-haspopup="menu" aria-expanded="false" aria-controls="aspect-menu"')}<img class="aspect-chevron" src="./prototype-assets/editor/aspect-chevron.svg" alt=""><div id="aspect-menu" class="aspect-menu" role="menu" aria-label="Формат кадрирования" hidden>${aspectOptions.map(([value,label])=>`<button type="button" role="menuitemradio" aria-checked="${aspect===value}" data-aspect-value="${value}">${label}<span class="aspect-dot" aria-hidden="true"></span></button>`).join('')}</div><select data-edit="aspect" aria-label="Формат кадрирования" hidden>${aspectOptions.map(([value,label])=>`<option value="${value}" ${aspect===value?'selected':''}>${label}</option>`).join('')}</select></div></div>${range('Угол','angle',-45,45,f.edits?.angle||0,.1)}${button(f.favorite?'♥':'♡','editor-favorite','favorite-button '+(favoritePulse?'favorite-pulse':''),`aria-label="Избранное" aria-pressed="${!!f.favorite}" title="Избранное"`)}<div class="edit-history">${button('↶','editor-undo','icon-button',`aria-label="Отменить действие" title="Отменить · ⌘Z" ${(history.canUndo(frameId)||cropChanged())?'':'disabled'}`)}${button('↷','editor-redo','icon-button',`aria-label="Повторить действие" title="Вернуть отменённое действие · ⌘⇧Z" ${history.canRedo(frameId)?'':'disabled'}`)}${button('Сбросить','editor-reset','subtle',hasEdits(f)?'':'disabled')}</div>${button('Удалить','editor-delete')}`;
    return `<main id="main" class="editor ${immersive?'immersive':''}" data-background="${background}"><div class="editor-body"><section class="editor-stage" aria-label="Фотография"><span class="editor-before" hidden>Оригинал</span><div class="compare-pair" hidden><figure><canvas></canvas></figure><figure><canvas></canvas></figure></div><div class="editor-picture"><canvas aria-label="${e(f.name)}"></canvas><div class="angle-grid" ${angleGrid?'':'hidden'}><output>${e(f.edits?.angle||0)}°</output></div><div class="crop-box" hidden tabindex="0" role="group" aria-label="Область кадрирования. Стрелки перемещают рамку"><i data-corner="nw"></i><i data-corner="ne"></i><i data-corner="sw"></i><i data-corner="se"></i></div><div class="split-line" hidden></div></div><p class="editor-loading" role="status">загрузка...</p></section><aside class="editor-tools">${tools}</aside><div class="viewer-icons">${button('⛶','editor-fullscreen','icon-button','aria-label="Фото без редактора" title="Фото без редактора · F"')}${theme}</div><div class="editor-comparison" ${canCompare(f)?'':'hidden'}>${button('◧','editor-original','icon-button',`aria-label="Показать оригинал" title="Показать оригинал" aria-pressed="${original}"`)}${button('◫','editor-compare','icon-button',`aria-label="Сравнить рядом" title="Сравнить рядом" aria-pressed="${sideBySide}"`)}</div></div><nav class="editor-filmstrip" aria-label="Лента кадров"><div class="editor-thumbs">${list.map(item=>`<button class="editor-thumb ${item.id===f.id?'active':''}" data-editor-frame="${e(item.id)}" aria-label="Открыть ${e(item.name)}" aria-current="${item.id===f.id?'true':'false'}">${imageMarkup(item,'editor-thumbnail')}</button>`).join('')}</div></nav></main>`;
  }

  async function draw(){
    const f=frame(),stage=root.querySelector('.editor-stage'),target=stage?.querySelector('.editor-picture canvas');if(!f||!target)return;
    const version=++drawVersion;
    const originalControl=root.querySelector('[data-action="editor-original"]');if(originalControl){originalControl.setAttribute('aria-pressed',String(original));}
    const comparison=root.querySelector('.editor-comparison');if(comparison)comparison.hidden=!canCompare(f);
    const wholeControl=root.querySelector('[data-action="editor-whole"]');if(wholeControl)wholeControl.textContent=wholeScan?'Показать кадр':'Общий скан';
    const before=root.querySelector('.editor-before');if(before)before.hidden=true;
    try{
      const source=await renderPhoto(original?comparisonOriginal(f):f,getFile,{uncropped:cropping,original:wholeScan||mode==='split',maxSize:photoSize&&zoom!=='fit'?Math.min(8192,Math.max(1800,Math.max(photoSize.w,photoSize.h)*Math.min(zoom,1))):1800});
      if(version!==drawVersion||!target.isConnected)return;
      target.width=source.width;target.height=source.height;target.getContext('2d').drawImage(source,0,0);
      const image=await sourceImage(f,getFile);if(version!==drawVersion||!target.isConnected)return;
      const entire=wholeScan||mode==='split',region=entire?{w:1,h:1}:safeCrop(f.region),edits=entire?{}:original?comparisonOriginal(f).edits:f.edits||{};
      let w=image.naturalWidth*region.w,h=image.naturalHeight*region.h;if((edits.turn||0)%2)[w,h]=[h,w];
      if(!cropping){const c=safeCrop(edits.crop);w*=c.w;h*=c.h;}
      photoSize={w,h};layoutPhoto();
      const pair=stage.querySelector('.compare-pair'),picture=stage.querySelector('.editor-picture');
      pair.hidden=!sideBySide;picture.hidden=sideBySide;
      if(sideBySide){const baseline=await renderPhoto(comparisonOriginal(f),getFile,{maxSize:1800});if(version!==drawVersion||!pair.isConnected)return;const canvases=pair.querySelectorAll('canvas');[baseline,source].forEach((value,i)=>{canvases[i].width=value.width;canvases[i].height=value.height;canvases[i].getContext('2d').drawImage(value,0,0);});}

      stage.querySelector('.editor-loading').hidden=true;updateOverlay();
    }catch(error){if(version===drawVersion&&target.isConnected){stage.querySelector('.editor-loading').textContent=error.message;}}
  }
  async function updateOverlay(){
    const crop=root.querySelector('.crop-box'),line=root.querySelector('.split-line'),f=frame();if(!crop||!f)return;
    crop.hidden=!cropping||original||wholeScan;line.hidden=mode!=='split';
    const c=safeCrop(f.edits?.crop);Object.assign(crop.style,{left:c.x*100+'%',top:c.y*100+'%',width:c.w*100+'%',height:c.h*100+'%'});
    if(mode==='split'){
      const image=await sourceImage(f,getFile);if(!line.isConnected)return;
      const vertical=split.direction==='vertical',gap=100*split.gap/(vertical?image.naturalWidth:image.naturalHeight);
      line.classList.toggle('horizontal',!vertical);Object.assign(line.style,{left:vertical?(split.boundary-gap/2)+'%':'0',top:vertical?'0':(split.boundary-gap/2)+'%',width:vertical?Math.max(.2,gap)+'%':'100%',height:vertical?'100%':Math.max(.2,gap)+'%'});
    }
  }
  function fitScale(){const stage=root.querySelector('.editor-stage');return stage&&photoSize?Math.min((stage.clientWidth-120)/photoSize.w,(stage.clientHeight-156)/photoSize.h):1;}
  function layoutPhoto(){
    const stage=root.querySelector('.editor-stage'),picture=stage?.querySelector('.editor-picture');if(!picture||!photoSize)return;
    const scale=zoom==='fit'?fitScale():zoom,w=photoSize.w*scale,h=photoSize.h*scale;
    pan.x=Math.max(-Math.max(0,(w-stage.clientWidth+48)/2),Math.min(Math.max(0,(w-stage.clientWidth+48)/2),pan.x));
    pan.y=Math.max(-Math.max(0,(h-stage.clientHeight+48)/2),Math.min(Math.max(0,(h-stage.clientHeight+48)/2),pan.y));
    Object.assign(picture.style,{width:w+'px',height:h+'px',transform:'translate(-50%,-50%) translate('+pan.x+'px,'+pan.y+'px)'});
    stage.classList.toggle('is-zoomed',w>stage.clientWidth||h>stage.clientHeight);
    const select=root.querySelector('[data-edit="zoom"]');if(select){const value=String(zoom);if(![...select.options].some(o=>o.value===value)){select.querySelector('[data-custom]')?.remove();const option=document.createElement('option');option.dataset.custom='true';option.value=value;option.textContent=Math.round(zoom*100)+'%';select.append(option);}select.value=value;}
  }
  function setZoom(value,point){
    if(!photoSize)return;const stage=root.querySelector('.editor-stage'),old=zoom==='fit'?fitScale():zoom;
    const next=value==='fit'?fitScale():Math.max(.05,Math.min(8,Number(value)));
    if(point){const box=stage.getBoundingClientRect(),x=point.x-box.left-box.width/2,y=point.y-box.top-box.height/2;pan={x:x-(x-pan.x)*next/old,y:y-(y-pan.y)*next/old};}else pan={x:0,y:0};
    zoom=value==='fit'?'fit':next;layoutPhoto();clearTimeout(zoomTimer);zoomTimer=setTimeout(()=>draw(),140);
  }
  function beginCrop(){if(mode!=='viewer')return;if(!cropping){cropBaseline=structuredClone(frame()?.edits||{});cropSnapshot=snapshot();}cropping=true;sideBySide=false;original=false;wholeScan=false;zoom='fit';pan={x:0,y:0};root.querySelector('[data-action="editor-crop"]')?.setAttribute('aria-pressed','true');return draw();}
  async function confirmCrop(){if(!cropping)return;await cropUpdate;commitCrop();drag=null;zoom='fit';pan={x:0,y:0};persist();rerender();}
  let angleDrag=null,angleMotion=0,angleSaveTimer,angleWheelTimer;
  function stopAngleMotion(){cancelAnimationFrame(angleMotion);angleMotion=0;angleDrag=null;}
  let resizeObserver;
  function mount(){stopAngleMotion();favoritePulse=false;updateHistory();resizeObserver?.disconnect();const stage=root.querySelector('.editor-stage');if(!stage)return;resizeObserver=new ResizeObserver(()=>draw());resizeObserver.observe(stage);draw();root.querySelector('.editor-thumb.active')?.scrollIntoView({block:'nearest',inline:'nearest'});}
  async function navigateBy(delta){const list=activeFrames(getRoll()),index=list.findIndex(f=>f.id===frameId),next=list[index+delta];if(next)navigate('viewer',next.id);}
  async function change(action,value){
    const f=frame(),r=getRoll();if(!f||working)return;
    if(cropping&&['rotate','favorite','reset','split','delete','fullscreen','original','compare','back','prev','next'].includes(action))commitCrop();
    if(desktop&&['save-file','rename-file','show-file','delete','split'].includes(action)){
      working=true;if(action!=='show-file')r.workStarted=true;try{
       if(action==='save-file'){await confirmCrop();await desktop.saveImage(f);}
       if(action==='rename-file')await desktop.rename(f);
       if(action==='show-file')await window.desktop.showFolder(f.id);
       if(action==='split'){const children=await desktop.split(f);history.clear(f.id);navigate('viewer',children[0].id);}
       if(action==='delete'){const list=activeFrames(r),index=list.indexOf(f);await desktop.remove(f);history.clear(f.id);const next=list[index+1]||list[index-1];if(next)navigate('viewer',next.id);else navigate('roll');}
      }catch(error){toast(error.message);}finally{working=false;rerender();}return;
    }
    if(action==='aspect-menu'){const menu=root.querySelector('.aspect-menu'),trigger=root.querySelector('.aspect-trigger');menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)menu.querySelector('[aria-checked=true]')?.focus();return;}
    if(action==='background'){background=value;root.querySelector('.editor').dataset.background=value;root.querySelectorAll('[data-action="editor-background"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===value)));await write('editor-background-v2',value).catch(()=>toast('Не удалось сохранить цвет фона'));return;}
    if(action==='back'){navigate('roll');return;}
    if(action==='prev'||action==='next'){await navigateBy(action==='next'?1:-1);return;}
    if(action==='fullscreen'){immersive=!immersive;sideBySide=false;original=false;cropping=false;angleGrid=false;zoom='fit';pan={x:0,y:0};rerender();return;}
    if(action==='crop'){if(cropping)await confirmCrop();else await beginCrop();return;}
    if(action==='original'||action==='compare'){if(!canCompare(f))return;cropping=false;wholeScan=false;zoom='fit';pan={x:0,y:0};if(action==='original'){original=!original;sideBySide=false;}else{sideBySide=!sideBySide;original=false;}rerender();return;}
    if(action==='whole'){wholeScan=!wholeScan;original=false;root.querySelector('[data-action="editor-whole"]').textContent=wholeScan?'Показать кадр':'Общий скан';draw();return;}
    if(action==='undo'||action==='redo'){if(cropping)commitCrop();const restored=history[action](f.id,snapshot());if(restored){Object.assign(f,restored);aspect=f.edits?.aspect||'original';await persist();rerender();}return;}
    if(action==='split'){
      if(!canSplit(r)||f.sourceFrameId||r.frames.some(x=>x.sourceFrameId===f.id))return;
      remember();const children=splitFrame(f,[{x:0,y:0,w:.5,h:1},{x:.5,y:0,w:.5,h:1}],()=>crypto.randomUUID());
      f.splitHidden=false;f.split={direction:'vertical',boundary:50,gap:0};r.frames.splice(r.frames.indexOf(f)+1,0,...children);
      await persist();navigate('viewer',children[0].id);return;
    }
    remember();
    if(action==='favorite'){f.favorite=!f.favorite;favoritePulse=true;}
    if(action==='delete'){const list=activeFrames(r),index=list.indexOf(f);f.deleted=true;await persist();const next=list[index+1]||list[index-1];if(next)navigate('viewer',next.id);else navigate('roll');return;}
    if(action==='rotate'){f.edits=rotateEdits(f.edits,Number(value)||1);aspect=f.edits.aspect||'original';original=false;wholeScan=false;zoom='fit';pan={x:0,y:0};}
    if(action==='reset'){sideBySide=false;f.edits={};original=false;wholeScan=false;cropping=false;aspect='original';zoom='fit';pan={x:0,y:0};}
    await persist();rerender();
  }
  root.addEventListener('click',event=>{
    if(!root.querySelector('.editor'))return;
    if(suppressClick){suppressClick=false;return;}
    if(event.target.closest('.editor-stage')&&!event.target.closest('.crop-box')&&!cropping&&!sideBySide){setZoom(zoom==='fit'?Math.max(1,fitScale()*2):'fit',{x:event.clientX,y:event.clientY});return;}
    const menu=root.querySelector('.aspect-menu'),trigger=root.querySelector('.aspect-trigger');
    const option=event.target.closest('[data-aspect-value]');
    if(option){const select=root.querySelector('[data-edit="aspect"]');select.value=option.dataset.aspectValue;trigger.textContent=option.textContent.trim();menu.querySelectorAll('[role=menuitemradio]').forEach(item=>item.setAttribute('aria-checked',String(item===option)));menu.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();select.dispatchEvent(new Event('change',{bubbles:true}));return;}
    if(menu&&!event.target.closest('.aspect-picker')){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}
    const thumb=event.target.closest('[data-editor-frame]');if(thumb){navigate('viewer',thumb.dataset.editorFrame);return;}
    const control=event.target.closest('[data-action^="editor-"]');if(control)change(control.dataset.action.slice(7),control.dataset.value);
  });
  root.addEventListener('input',event=>{
    const name=event.target.dataset.edit;if(!name||!frame())return;
    if(['angle','boundary','gap'].includes(name)){
      const value=Number(event.target.value);if(!Number.isFinite(value))return;
      const output=root.querySelector(`[data-output="${name}"]`);if(output)output.textContent=value;
      if(name==='angle'){if(!event.target.dataset.started){remember();event.target.dataset.started='yes';}frame().edits={...frame().edits,angle:value};paintAngle(event.target,value);updateHistory();angleGrid=true;const grid=root.querySelector('.angle-grid');grid.hidden=false;grid.querySelector('output').textContent=value+'°';sideBySide=false;original=false;wholeScan=false;draw();clearTimeout(angleSaveTimer);angleSaveTimer=setTimeout(()=>persist(),250);}
      else {split[name]=value;updateOverlay().catch(()=>{});}
    }
  });
  root.addEventListener('change',async event=>{
    const name=event.target.dataset.edit;if(!name||!frame())return;delete event.target.dataset.started;
    if(name==='angle'){clearTimeout(angleSaveTimer);persist();return;}
    if(name==='zoom'){setZoom(event.target.value);return;}
    if(name==='direction'){split.direction=event.target.value;updateOverlay().catch(()=>{});}
    if(name==='aspect'){
      aspect=event.target.value;const cropFrame=frame();cropUpdate=beginCrop();await cropUpdate;if(frame()!==cropFrame)return;const canvas=root.querySelector('.editor-picture canvas');let w=1,h=1;
      if(!['original','free'].includes(aspect)){const ratio=Number(aspect)/(photoSize?photoSize.w/photoSize.h:canvas.width/canvas.height);if(ratio<1)w=ratio;else h=1/ratio;}
      frame().edits={...frame().edits,aspect,crop:{x:(1-w)/2,y:(1-h)/2,w,h}};updateOverlay();updateHistory();persist();
    }
  });
  document.addEventListener('click',event=>{if(event.target.closest('.aspect-picker'))return;const menu=root.querySelector('.aspect-menu');if(menu){menu.hidden=true;root.querySelector('.aspect-trigger')?.setAttribute('aria-expanded','false');}});
  function setAngleValue(input,value){
    if(!input.isConnected)return;const bounded=Math.max(-45,Math.min(45,Math.round(value*10)/10));
    if(Number(input.value)===bounded)return;input.value=String(bounded);input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function settleAngle(input){if(!input.isConnected)return;const value=Number(input.value);if(Math.abs(value)<.35)setAngleValue(input,0);input.closest('.angle-control').classList.remove('is-scrolling');input.dispatchEvent(new Event('change',{bubbles:true}));clearTimeout(angleSaveTimer);persist();}
  root.addEventListener('pointerdown',event=>{const input=event.target.closest('input[data-edit="angle"]');if(!input)return;event.preventDefault();stopAngleMotion();clearTimeout(angleWheelTimer);input.focus();input.setPointerCapture(event.pointerId);input.closest('.angle-control').classList.add('is-scrolling');angleDrag={input,id:event.pointerId,x:event.clientX,value:Number(input.value),lastX:event.clientX,lastTime:performance.now(),velocity:0};});
  root.addEventListener('pointermove',event=>{if(!angleDrag||angleDrag.id!==event.pointerId)return;const d=angleDrag,now=performance.now(),dt=Math.max(1,now-d.lastTime);d.velocity=.35*d.velocity+.65*(-(event.clientX-d.lastX)/angleSpacing/dt);d.lastX=event.clientX;d.lastTime=now;setAngleValue(d.input,d.value-(event.clientX-d.x)/angleSpacing);});
  const finishAngle=event=>{
    if(!angleDrag)return;const d=angleDrag;angleDrag=null;
    let velocity=performance.now()-d.lastTime>90?0:Math.max(-.12,Math.min(.12,d.velocity));
    if(event.type==='pointercancel'||matchMedia('(prefers-reduced-motion: reduce)').matches)velocity=0;
    let value=Number(d.input.value),last=performance.now();
    const coast=now=>{if(!d.input.isConnected){angleMotion=0;return;}const dt=Math.min(32,now-last);last=now;velocity*=Math.exp(-dt/140);value=Math.max(-45,Math.min(45,value+velocity*dt));setAngleValue(d.input,value);if(Math.abs(velocity)<.001||Math.abs(value)>=45){angleMotion=0;settleAngle(d.input);return;}angleMotion=requestAnimationFrame(coast);};
    if(Math.abs(velocity)<.001)settleAngle(d.input);else angleMotion=requestAnimationFrame(coast);
  };
  root.addEventListener('pointerup',finishAngle);root.addEventListener('pointercancel',finishAngle);
  root.addEventListener('wheel',event=>{const control=event.target.closest('.angle-control');if(!control)return;event.preventDefault();stopAngleMotion();const input=control.querySelector('input');control.classList.add('is-scrolling');const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;setAngleValue(input,Number(input.value)+delta*(event.deltaMode===1?1:.08));clearTimeout(angleWheelTimer);angleWheelTimer=setTimeout(()=>settleAngle(input),160);},{passive:false});
  root.addEventListener('focusin',event=>{if(event.target.dataset.edit==='angle'){angleGrid=true;const grid=root.querySelector('.angle-grid');if(grid)grid.hidden=false;}});
  root.addEventListener('focusout',event=>{if(event.target.dataset.edit==='angle'){angleGrid=false;const grid=root.querySelector('.angle-grid');if(grid)grid.hidden=true;}});
  root.addEventListener('wheel',event=>{
    if(!event.target.closest('.editor-stage')||!photoSize||sideBySide)return;event.preventDefault();
    const current=zoom==='fit'?fitScale():zoom,factor=Math.exp(-event.deltaY*(event.ctrlKey?.012:.002));
    setZoom(current*factor,{x:event.clientX,y:event.clientY});
  },{passive:false});
  root.addEventListener('pointerdown',event=>{
    const stage=event.target.closest('.editor-stage'),box=event.target.closest('.crop-box');
    if(stage&&!box&&!sideBySide){panDrag={id:event.pointerId,x:event.clientX,y:event.clientY,pan:{...pan},moved:false};stage.setPointerCapture(event.pointerId);return;}
    if(!box||!cropping)return;
    event.preventDefault();remember();const bounds=box.parentElement.getBoundingClientRect();drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,bounds,crop:safeCrop(frame().edits?.crop),corner:event.target.dataset.corner||'',lastX:event.clientX,lastY:event.clientY};box.setPointerCapture(event.pointerId);
  });
  root.addEventListener('pointermove',event=>{
    if(panDrag&&panDrag.id===event.pointerId){const dx=event.clientX-panDrag.x,dy=event.clientY-panDrag.y;if(Math.abs(dx)+Math.abs(dy)>3)panDrag.moved=true;pan={x:panDrag.pan.x+dx,y:panDrag.pan.y+dy};layoutPhoto();return;}
    if(!drag||drag.id!==event.pointerId)return;
    resizeCropAt(event.clientX,event.clientY,event.altKey);
  });
  function resizeCropAt(x,y,centered){
    if(!drag)return;drag.lastX=x;drag.lastY=y;
    const dx=(x-drag.startX)/drag.bounds.width,dy=(y-drag.startY)/drag.bounds.height,c={...drag.crop};
    if(!drag.corner){c.x=Math.max(0,Math.min(1-c.w,c.x+dx));c.y=Math.max(0,Math.min(1-c.h,c.y+dy));}
    else {
      let left=c.x,top=c.y,right=c.x+c.w,bottom=c.y+c.h;
      if(drag.corner.includes('w'))left=Math.max(0,Math.min(right-.03,left+dx));else right=Math.min(1,Math.max(left+.03,right+dx));
      if(drag.corner.includes('n'))top=Math.max(0,Math.min(bottom-.03,top+dy));else bottom=Math.min(1,Math.max(top+.03,bottom+dy));
      if(centered){
        const cx=drag.crop.x+drag.crop.w/2,cy=drag.crop.y+drag.crop.h/2;
        let hw=Math.max(.015,Math.min(cx,1-cx,drag.crop.w/2+(drag.corner.includes('w')?-dx:dx)));
        let hh=Math.max(.015,Math.min(cy,1-cy,drag.crop.h/2+(drag.corner.includes('n')?-dy:dy)));
        if(aspect!=='free'){const ratio=aspect==='original'?1:Number(aspect)/(drag.bounds.width/drag.bounds.height);hw=Math.min(hw,hh*ratio);hh=hw/ratio;}
        left=cx-hw;right=cx+hw;top=cy-hh;bottom=cy+hh;
      }
      c.x=left;c.y=top;c.w=right-left;c.h=bottom-top;
      if(aspect!=='free'){const ratio=aspect==='original'?1:Number(aspect)/(drag.bounds.width/drag.bounds.height);let w=Math.min(c.w,c.h*ratio),h=w/ratio;c.x=drag.corner.includes('w')?right-w:left;c.y=drag.corner.includes('n')?bottom-h:top;c.w=w;c.h=h;}
    }
    frame().edits={...frame().edits,crop:safeCrop(c)};updateOverlay();updateHistory();
  }
  const optionChanged=event=>{if(event.key==='Alt'&&drag?.corner){event.preventDefault();resizeCropAt(drag.lastX,drag.lastY,event.type==='keydown');}};
  document.addEventListener('keydown',optionChanged);document.addEventListener('keyup',optionChanged);
  const finishDrag=()=>{updateHistory();if(panDrag){suppressClick=panDrag.moved;panDrag=null;}if(drag){drag=null;persist();suppressClick=true;}};root.addEventListener('pointerup',finishDrag);root.addEventListener('pointercancel',finishDrag);
  root.addEventListener('keydown',event=>{
    if(!event.target.closest('.crop-box'))return;
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();remember();const c=safeCrop(frame().edits?.crop),step=event.shiftKey?.05:.01;
    c.x=Math.max(0,Math.min(1-c.w,c.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0)));c.y=Math.max(0,Math.min(1-c.h,c.y+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0)));frame().edits={...frame().edits,crop:c};updateOverlay();persist();
  });
  document.addEventListener('keydown',event=>{
    if(!root.querySelector('.editor')||event.altKey||event.defaultPrevented||document.querySelector('dialog[open]'))return;
    const textInput=event.target.closest('input:not([type=range]),textarea');
    const shortcut=event.code==='KeyZ'?'z':event.code==='KeyY'?'y':event.key.toLowerCase();if(!textInput&&(event.ctrlKey||event.metaKey)&&['z','y'].includes(shortcut)){event.preventDefault();stopAngleMotion();change(event.shiftKey||shortcut==='y'?'redo':'undo');return;}
    const menu=root.querySelector('.aspect-menu');
    if(menu&&!menu.hidden){if(event.key==='Escape'){event.preventDefault();menu.hidden=true;const trigger=root.querySelector('.aspect-trigger');trigger.setAttribute('aria-expanded','false');trigger.focus();return;}if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const options=[...menu.querySelectorAll('button')],i=options.indexOf(document.activeElement);options[event.key==='Home'?0:event.key==='End'?options.length-1:(i+(event.key==='ArrowDown'?1:-1)+options.length)%options.length].focus();return;}}
    if(event.key==='Enter'&&cropping){event.preventDefault();confirmCrop();return;}
    if(event.key==='Escape'){event.preventDefault();stopAngleMotion();if(cropping){if(cropBaseline)frame().edits=structuredClone(cropBaseline);cropping=false;cropSnapshot=null;cropBaseline=null;drag=null;angleGrid=false;aspect=frame().edits?.aspect||'original';persist();rerender();}else if(sideBySide||original){sideBySide=false;original=false;rerender();}else if(immersive){immersive=false;rerender();}else{angleGrid=false;navigate('roll');}return;}
    if(event.key.toLowerCase()==='f'&&!textInput){event.preventDefault();change('fullscreen');return;}
    if(event.target.closest('input,select,textarea,.crop-box'))return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();navigateBy(event.key==='ArrowRight'?1:-1);}
    if(event.key.toLowerCase()==='l'){event.preventDefault();change('favorite');}
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();change('delete');}
    
    if(event.key==='\\'){event.preventDefault();change('original');}
  });
  return {enter,markup,mount,command:change,clearHistory:key=>{history.clear(key);for(const f of getRoll()?.frames||[])history.clear(f.id);}};
}
