import {createMotion} from './motion.js';
import {createThumbnails} from './thumbnails.js';
import {createUploadUI} from './upload-ui.js';
import {createEditor} from './editor.js';
import {activeFrames,trashedFrames,restoreSelectedFrames,canSplit,scanCount} from './editor-model.js';
import {renderPhoto} from './photo-renderer.js';
import { filmCatalog, isoValues, inferFolderMetadata, periodLabel, validPeriod, uploadFolderMetadata, filenameStem, numberedFilename } from './metadata.js';
import { groupFiles, filterRolls, filterFrames, selectFrame, pruneSelection, plural, isJPEG, appendPhotos, rollStatus } from './model.js';
import { demoRolls } from './demo.js';
import { read, write, writeBatch, resetOnce, removeKeys } from './storage.js';

const native=window.desktop;
const root=document.querySelector('#app');
const motion=createMotion(root);
let revealPhotos=false,motionRollId='',preserveAlbumFrames=false;
const getPhotoFile=id=>native?native.bytes(id).then(bytes=>new Blob([bytes],{type:'image/jpeg'})):files.get(id);
const picker=document.querySelector('#folder-picker');
const photosPicker=document.querySelector('#photos-picker');
let draft={}, combined=false,uploadSession=null,uploadEpoch=0;
function beginUpload(){if(!uploadSession)uploadSession={rolls,sources,realRolls,demo,frames:new Set(),token:null,tokens:[]};}
function updateUploadBase(){if(!uploadSession)return;const committed=rolls.filter(r=>!pending.includes(r.id));uploadSession.rolls=committed;uploadSession.realRolls=committed;uploadSession.sources=sources.filter(source=>committed.some(r=>r.sourceId===source.id));uploadSession.demo=false;}
function discardUpload(){uploadEpoch++;const session=uploadSession;if(session){for(const id of session.frames){const url=urls.get(id);if(url)URL.revokeObjectURL(url);urls.delete(id);files.delete(id);}rolls=session.rolls;sources=session.sources;realRolls=session.realRolls;demo=session.demo;uploadSession=null;if(native)for(const token of session.tokens||[session.token].filter(Boolean))native.cancelUpload(token).catch(error=>toast(error.message));}pending=[];draft={};combined=false;uploadTarget=null;pickerSource=null;picker.value='';photosPicker.value='';}

let uploadTarget=null, pending=[], editId='', openedRolls=new Set();
const files=new Map(), urls=new Map(), handles=new Map();
let sources=[], rolls=[], realRolls=[], demo=false, lastRoll='', selected=new Set(), anchor='', selecting=false;
let archiveFilter={query:'',film:'',period:'',incomplete:false}, frameFilter={query:'',unseen:false,rating:''};
let busy=false, busyLabel='', persistence=true, pickerSource=null, timer, observer, noteObserver;
let page='archive', rollId='',albumLayout='squares',renderedPage='';
const albumLayouts=new Map();

let trashSelection=new Set(),trashAnchor='',restoring=false,trashSelecting=false,trashPreview='';
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uploadUI=createUploadUI({root,e,button,imageMarkup:img,onDraft:(name,value)=>draft[name]=value,getData:()=>({...rolls.find(r=>r.id===(pending[0]||editId)),...draft})});
const count=(n,type)=>plural(n,{roll:['плёнка','плёнки','плёнок'],scan:['скан','скана','сканов'],frame:['кадр','кадра','кадров']}[type]);
const viewed=r=>activeFrames(r).filter(f=>f.viewed).length;
const editorPages=['viewer','crop','split'];
const thumbnails=createThumbnails(id=>native?native.thumbnail(id).then(bytes=>new Blob([bytes],{type:'image/jpeg'})):files.get(id));
let editorFrameId='';
const date=periodLabel;
const current=()=>rolls.find(r=>r.id===rollId);
const visibleFrames=()=>filterFrames(current()?.frames || [],frameFilter);
const editor=createEditor({root,button,e,getRoll:current,getFile:getPhotoFile,desktop:native?{saveImage:saveNativeImage,split:splitNative,remove:removeNative,rename:renameNative}:null,save,navigate:(next,id)=>{if(next==='roll'){go('roll',rollId);return;}const hash='#'+next+'/'+encodeURIComponent(rollId)+'/'+encodeURIComponent(id);if(location.hash===hash)route();else location.hash=hash;},rerender:()=>render(),selection:()=>selected,toast,imageMarkup:img});
function openFrame(id,mode='viewer'){location.hash='#'+mode+'/'+encodeURIComponent(rollId)+'/'+encodeURIComponent(id);}
const disabledHint='Следующий этап: этот экран пока не реализован';
function button(label,action='',variant='',attrs='') {return `<button class="button ${variant}" ${action?`data-action="${action}"`:''} ${attrs}>${e(label)}</button>`;}
function later(label,variant='') {return button(label,'',variant,`disabled title="${disabledHint}"`);}
function img(frame, cls='', eager=false) {
  if (!frame) return `<div class="photo-placeholder ${cls}" aria-label="Нет обложки">▥</div>`;
  const src=frame.demoUrl||thumbnails.peek(frame);
  return `<div class="photo-slot ${cls}"><img ${src?`src="${e(src)}"`:''} data-photo="${e(frame.id)}" alt="${e(frame.name)}" loading="${eager?'eager':'lazy'}" decoding="async"><span class="photo-fallback">${src || (native||files.has(frame.sourceFrameId||frame.id))?'загрузка...':'Подключите папку'}</span></div>`;
}
let inlineMessage='';
function toast(message) {inlineMessage=String(message);const host=root.querySelector('#main')||root;let n=host.querySelector('.inline-message');if(!n){n=document.createElement('p');n.className='inline-message';n.setAttribute('role','alert');host.prepend(n);}n.textContent=inlineMessage;}
async function save() {
  try {if(!demo&&!uploadSession)realRolls=rolls;const saved=uploadSession||{sources,realRolls,demo};await write('archive',{sources:saved.sources,rolls:saved.realRolls,demo:saved.demo,lastRoll,openedRolls:[...openedRolls],pending:[],selected:[...selected],selecting});persistence=true;}
  catch {persistence=false;toast('Не удалось сохранить изменения. Проверьте доступ к папке и свободное место.');throw Error('Не удалось сохранить каталог');}
}
function route() {
  const previousPage=page,previousRoll=rollId;inlineMessage='';
  trashSelection.clear();trashAnchor='';trashSelecting=false;trashPreview='';
  const parts=location.hash.slice(1).split('/');if(uploadSession&&!['upload','metadata'].includes(parts[0]))discardUpload();
  page=parts[0] || 'archive';
  if(page==='welcome')page='archive';
  if(page==='upload')combined=true;
  try {rollId=decodeURIComponent(editorPages.includes(page)?parts[1]||'':parts.slice(1).join('/'));editorFrameId=editorPages.includes(page)?decodeURIComponent(parts[2]||''):'';} catch {rollId='';}
  if ((page==='roll'||page==='trash'||editorPages.includes(page)) && !current()) page='archive';
  if(pending.length&&['welcome','upload','metadata'].includes(page))page='metadata';
  if(page==='metadata'&&!pending.length&&!editId)page='archive';
  if (!['welcome','archive','roll','trash','metadata','upload',...editorPages].includes(page)) page='archive';
  if(page==='roll'){albumLayout=albumLayouts.get(rollId)||'squares';if(previousRoll!==rollId||!['roll',...editorPages].includes(previousPage))frameFilter={query:'',unseen:false,rating:''};}
  if(page==='roll'||editorPages.includes(page)){lastRoll=rollId;openedRolls.add(rollId);save();}
  if(editorPages.includes(page)){const f=activeFrames(current()).find(f=>f.id===editorFrameId)||activeFrames(current())[0];if(f){editorFrameId=f.id;editor.enter(page,f.id);}else page='roll';}
  render();window.scrollTo(0,0);
}
function go(next,id='') {const hash=`#${next}${id?'/'+encodeURIComponent(id):''}`;if(location.hash===hash)route();else location.hash=hash;}
const filmNames=filmCatalog.map(([name])=>name);
function chooseControl(){return button('Выбрать','choose','primary',`type="button" ${busy?'disabled':''}`);}
function uploadField(){return `<div class="upload-zone inline-upload" data-drop-zone><span class="upload-symbol" aria-hidden="true">↑</span><p>${busy?e(busyLabel):(native?'Откройте папку с фотографиями':'Загрузите файлы или папку целиком')}</p><div class="upload-actions">${chooseControl()}</div></div>`;}
function metadata() {
 const stored=rolls.find(r=>r.id===(pending[0]||editId));
 const r={title:'',film:'',iso:'',camera:'',dateStart:'',dateEnd:'',number:'',frames:[],...stored,...draft,filmNames};
 return uploadUI.markup(r,{busy,edit:!!editId,pendingCount:pending.length});
}

function shell(content) {
  const films=[...new Set(rolls.map(r=>r.film).filter(Boolean))];
  const years=[...new Set(rolls.flatMap(r=>[r.dateStart,r.dateEnd,r.date].filter(Boolean).join(' ').match(/\b(?:19|20)\d{2}\b/g)||[]))].sort().reverse();
  return `<div class="app horizontal-app"><header class="site-header"><a class="brand" href="#archive">ндзд архв</a>${page==='archive'?`<div class="archive-tabs" role="tablist" aria-label="Категории архива">${button('Все','archive','nav-button '+(!archiveFilter.incomplete?'active':''),`role="tab" aria-selected="${!archiveFilter.incomplete}"`)}${button('Не разобраны','incomplete','nav-button '+(archiveFilter.incomplete?'active':''),`role="tab" aria-selected="${archiveFilter.incomplete}"`)}</div><label class="header-filter"><select id="film-filter" aria-label="Плёнка"><option value="">Плёнка</option>${films.map(f=>`<option ${f===archiveFilter.film?'selected':''}>${e(f)}</option>`).join('')}</select></label><label class="header-filter"><select id="period-filter" aria-label="Дата"><option value="">Дата</option>${years.map(y=>`<option ${y===archiveFilter.period?'selected':''}>${e(y)}</option>`).join('')}</select></label>${button('Загрузить','upload','primary header-upload',busy?'disabled':'')}`:''}</header><main id="main" class="main ${page==='roll'?'roll-main':''}">${busy?`<div class="notice" role="status">${e(busyLabel)}</div>`:''}${!demo?sources.filter(s=>s.mode!=='stored'&&s.mode!=='desktop'&&!handles.has(s.id)).map(s=>`<div class="notice reconnect"><span>Подключите папку «${e(s.name)}», чтобы увидеть фотографии.</span>${button('Подключить снова','reconnect','',`data-source="${e(s.id)}"`)}</div>`).join(''):''}${content}</main></div>`;
}
function archive() {
 const lastOpened=openedRolls.has(lastRoll)?rolls.find(r=>r.id===lastRoll):null;
 const recent=lastOpened&&!lastOpened.completed?lastOpened:null,found=filterRolls(rolls,archiveFilter);
 let note='';try{note=localStorage.getItem('plenka-archive-note')||'';}catch{}
 const status=rollStatus;
 const cards=found.map(r=>{const [state,label]=status(r);return `<a class="archive-card" href="#roll/${encodeURIComponent(r.id)}"><div class="archive-card-meta"><p>${e(r.number||'—')}<br>${e(date(r))}</p><span class="archive-status ${state}" aria-label="${label}"><span>${label}</span></span></div><div class="archive-card-media">${img(activeFrames(r)[0],'archive-cover')}</div><div class="archive-card-copy"><h2>${e(r.title||'Без названия')}</h2><p>${e(r.film||'Плёнка не указана')} · ${count(activeFrames(r).length,'frame')}</p></div></a>`;});
 const add=`<button class="archive-add" data-action="upload" aria-label="Добавить плёнку" ${busy?'disabled':''}><img src="data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjE0MCIgaGVpZ2h0PSIxNDAiIHZpZXdCb3g9IjAgMCAxNDAgMTQwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8ZyBpZD0iR3JvdXAgNyI+CjxwYXRoIGlkPSJWZWN0b3IgMTYiIGQ9Ik03MCAwVjE0MCIgc3Ryb2tlPSIjMjYyMjFEIiBzdHJva2Utd2lkdGg9IjMiLz4KPHBhdGggaWQ9IlZlY3RvciAxNyIgZD0iTTE0MCA3MEw1Ljg0NzIyZS0wNiA3MCIgc3Ryb2tlPSIjMjYyMjFEIiBzdHJva2Utd2lkdGg9IjMiLz4KPC9nPgo8L3N2Zz4K" alt=""></button>`;
 
 while(cards.length<2)cards.push('<div class="archive-blank" aria-hidden="true"></div>');
 return `<div class="archive-page ${recent?'with-recent':''}"><header class="archive-header"><a class="archive-brand" href="#archive">ндзд архв</a><div class="header-controls" data-mode="archive"><div class="archive-category" role="tablist" aria-label="Категории архива">${button('Все','archive',!archiveFilter.incomplete?'active':'',`role="tab" aria-selected="${!archiveFilter.incomplete}"`)}${button('Не разобраны','incomplete',archiveFilter.incomplete?'active':'',`role="tab" aria-selected="${archiveFilter.incomplete}"`)}</div></div></header><main id="main" class="archive-main">${busy?`<div class="notice" role="status">${e(busyLabel)}</div>`:''}${!demo?sources.filter(s=>s.mode!=='stored'&&s.mode!=='desktop'&&!handles.has(s.id)).map(s=>`<div class="notice reconnect"><span>Подключите папку «${e(s.name)}», чтобы увидеть фотографии.</span>${button('Подключить снова','reconnect','',`data-source="${e(s.id)}"`)}</div>`).join(''):''}<section class="archive-intro ${recent?'has-recent':''}"><textarea id="archive-note" aria-label="Заметки к архиву" placeholder="муся, напиши заметочку, чтобы ничего не забыть" spellcheck="false">${e(note)}</textarea>${recent?`<button class="archive-resume" data-action="resume" aria-label="Продолжить работу: ${e(recent.title||'Без названия')}">${img(activeFrames(recent)[0],'archive-resume-cover',true)}<span>Продолжить работу<img src="./prototype-assets/archive/arrow.svg" alt=""></span></button>`:''}</section><div class="archive-shelf ${rolls.length?'':'is-empty'}">${add}<div class="archive-scroll" tabindex="0" aria-label="Папки плёнок"><div class="archive-grid" aria-label="Плёнки">${cards.join('')}</div>${!found.length&&rolls.length?'<p class="archive-empty">Нет неразобранных плёнок.</p>':''}</div></div></main></div>`;
}

// Fit both saved notes and the placeholder whenever text or available space changes.
function fitArchiveNote(){
 const note=root.querySelector('#archive-note');if(!note||!note.clientHeight)return;
 const max=matchMedia('(max-width:600px)').matches?48:matchMedia('(max-width:900px)').matches?60:78;
 let low=1,high=max;
 while(high-low>.25){const size=(low+high)/2;note.style.fontSize=size+'px';note.style.letterSpacing=(-size*.04)+'px';if(note.scrollHeight<=note.clientHeight+1&&note.scrollWidth<=note.clientWidth+1)low=size;else high=size;}
 note.style.fontSize=low+'px';note.style.letterSpacing=(-low*.04)+'px';note.scrollTop=0;
}

function roll() {
 const r=current(),frames=visibleFrames(),chosen=activeFrames(r).filter(f=>selected.has(f.id)).length,[state,label]=rollStatus(r);
 return `<div class="album-page ${selecting?'is-selecting':''}"><header class="album-header"><a class="archive-brand" href="#archive">ндзд архв</a><div class="header-controls" data-mode="roll">${button('','favorites','album-favorites',`aria-label="Показать избранное" aria-pressed="${!!frameFilter.favorites}" ${selecting?'disabled':''}`).replace('</button>','<img src="./prototype-assets/archive/header-heart.svg" alt=""></button>')}${button('Редактировать','edit-metadata','',selecting?'disabled':'')}${button('Отключить папку','disconnect-roll','',selecting?'disabled':'')}</div></header><main id="main" class="album-main"><div class="album-title-row"><h1>${e(r.title||'Без названия')}</h1><span class="album-status ${state}">${label}</span></div><div class="album-info-row"><div class="album-meta"><p>${e(r.number||'—')}<br>${e(date(r))}</p><p>${e(r.film||'Плёнка не указана')}<br>${count(activeFrames(r).length,'frame')}</p></div><div class="album-views" role="group" aria-label="Отображение фотографий">${button('','album-layout','view-squares',`data-layout="squares" aria-label="Квадраты" aria-pressed="${albumLayout==='squares'}"`).replace('</button>','<span aria-hidden="true"></span></button>')}${button('','album-layout','view-originals',`data-layout="originals" aria-label="Исходные пропорции" aria-pressed="${albumLayout==='originals'}"`).replace('</button>','<span aria-hidden="true"><i></i><i></i><i></i><i></i></span></button>')}</div></div><div class="album-grid ${albumLayout}" aria-label="Кадры плёнки">${frames.map(f=>`<article class="album-frame ${selected.has(f.id)?'is-selected':''}"><button class="album-open" data-frame="${e(f.id)}" aria-label="Открыть ${e(f.name)}">${img(f,'album-image')}</button><div class="album-frame-tools">${button('','photo-select','photo-select',`data-id="${e(f.id)}" aria-label="Выбрать ${e(f.name)}" aria-pressed="${selected.has(f.id)}"`)}<div>${button('','photo-favorite','photo-favorite',`data-id="${e(f.id)}" aria-label="Избранное: ${e(f.name)}" aria-pressed="${!!f.favorite}" ${selecting?'disabled':''}`).replace('</button>','<img class="normal" src="./prototype-assets/archive/album-heart.svg" alt=""><img class="filled" src="./prototype-assets/archive/album-heart-active.svg" alt=""></button>')}${button('','photo-delete','photo-delete',`data-id="${e(f.id)}" aria-label="Удалить ${e(f.name)}" ${selecting?'disabled':''}`).replace('</button>','<img class="normal" src="./prototype-assets/archive/album-delete.svg" alt=""><img class="filled" src="./prototype-assets/archive/album-delete-hover.svg" alt=""></button>')}</div></div></article>`).join('')}</div>${!frames.length?`<section class="empty"><h2>${frameFilter.favorites?'в избранном пока нет фотографий':'нет фотографий'}</h2></section>`:''}${!frameFilter.favorites?button(r.completed?'Вернуть в работу':'Отметить съёмку готовой','roll-complete','album-done',`aria-pressed="${!!r.completed}" ${selecting?'disabled':''}`):''}</main>${chosen>=1?`<nav class="album-batch" aria-label="Действия с выбранными фото"><div>${button(frames.length&&frames.every(f=>selected.has(f.id))?'Снять выделение':'Выбрать все','select-all')}${button('Добавить в избранное','batch-favorite')}${button('Удалить','batch-delete')}</div></nav>`:''}</div>`;
}
async function deleteAlbumFrames(ids,batch=false){
 const r=current(),targets=activeFrames(r).filter(f=>ids.includes(f.id));if(targets.length)r.workStarted=true;
 try{for(const f of targets){if(native)await removeNative(f,{persist:false});else f.deleted=true;selected.delete(f.id);}editor.clearHistory(r.id);if(batch){selected.clear();selecting=false;}await save();}catch(error){toast(error.message);}finally{preserveAlbumFrames=true;render();}
}

function trash() {
 const frames=trashedFrames(current());
 return shell(`${button('← Назад','trash-back','subtle trash-back')}<header class="roll-heading"><h1>Корзина</h1><div class="actions">${button(trashSelecting?'Завершить выбор':'Выбрать фото','trash-select','',frames.length&&!restoring?`aria-pressed="${trashSelecting}"`:'disabled')}${trashSelection.size?button(restoring?'Восстанавливаем…':'Восстановить','trash-restore','primary',restoring?'disabled':''):''}</div></header><div class="photo-grid album-photos" aria-label="Удалённые кадры">${frames.map(f=>`<button class="photo-card ${trashSelecting&&trashSelection.has(f.id)?'selected':''}" data-trash-frame="${e(f.id)}" ${trashSelecting?`aria-pressed="${trashSelection.has(f.id)}"`:''} aria-label="${trashSelecting?'Выбрать':'Открыть'} ${e(f.name)}" ${restoring?'disabled':''}>${img(f,'frame-image')}${trashSelecting?`<span class="check visible" aria-hidden="true">${trashSelection.has(f.id)?'✓':''}</span>`:''}</button>`).join('')}</div>${!frames.length?'<section class="empty"><h2>Корзина пуста</h2></section>':''}${trashPreview?`<div class="trash-preview" role="dialog" aria-modal="true" aria-label="Просмотр фотографии">${button('×','trash-close','icon-button','aria-label="Закрыть фотографию"')}<div class="trash-preview-photo"><p role="status">загрузка...</p></div></div>`:''}`);
}
async function drawTrashPreview(){
 const id=trashPreview,f=trashedFrames(current()).find(f=>f.id===id),target=root.querySelector('.trash-preview-photo');if(!f||!target)return;
 try{const canvas=await renderPhoto(f,getPhotoFile,{maxSize:2400});if(trashPreview===id&&target.isConnected){canvas.setAttribute('aria-label',f.name);target.replaceChildren(canvas);}}catch(error){if(target.isConnected)target.textContent=error.message;}
 root.querySelector('[data-action="trash-close"]')?.focus();
}
async function restoreTrashSelection() {
  if(restoring||!trashSelection.size)return;
  const r=current(),frames=restoreSelectedFrames(r,trashSelection),amount=trashedFrames(r).length-trashedFrames({frames}).length;
  if(!amount)return;
  restoring=true;render();
  try {
    const updated=rolls.map(item=>item===r?{...r,frames}:item);
    await write('archive',{sources,rolls:demo?realRolls:updated,demo,lastRoll,openedRolls:[...openedRolls],pending,selected:[...selected],selecting});
    r.frames=frames;if(!demo)realRolls=rolls;
    editor.clearHistory(r.id);trashSelection.clear();persistence=true;

  } catch {toast('Не удалось восстановить фотографии. Попробуйте ещё раз.');}
  finally {restoring=false;render();}
}
function render(focusId) {
  observer?.disconnect();
  noteObserver?.disconnect();
  const preservedSearch=focusId==='query'?root.querySelector('.topbar'):null;
  const cursor=document.activeElement?.selectionStart;
  const oldBatch=root.querySelector('.album-batch');
  const previous=renderedPage;renderedPage=page;
  const keepFrames=preserveAlbumFrames&&page==='roll'&&previous==='roll'&&motionRollId===rollId;preserveAlbumFrames=false;
  const before=motion.capture({album:keepFrames});
  root.innerHTML=page==='archive'?archive():page==='trash'?trash():(page==='metadata'||page==='upload')?metadata():editorPages.includes(page)?editor.markup():roll();
  if(keepFrames){root.querySelectorAll('.album-frame').forEach(fresh=>{const id=fresh.querySelector('[data-frame]').dataset.frame,old=before.frames.get(id)?.node;if(!old)return;old.className=fresh.className;old.querySelectorAll('[data-action]').forEach(control=>{const next=fresh.querySelector(`[data-action="${control.dataset.action}"]`);if(!next)return;control.disabled=next.disabled;if(next.hasAttribute('aria-pressed'))control.setAttribute('aria-pressed',next.getAttribute('aria-pressed'));});fresh.replaceWith(old);});motion.reflow(before);}
  const newBatch=root.querySelector('.album-batch'),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(oldBatch&&newBatch){oldBatch.querySelector('[data-action=select-all]').textContent=newBatch.querySelector('[data-action=select-all]').textContent;newBatch.replaceWith(oldBatch);}
  else if(newBatch&&!reduced){newBatch.animate([{opacity:0,translate:'0 140%'},{opacity:1,translate:'0 0'}],{duration:380,easing:'cubic-bezier(.22,1,.36,1)'});}
  else if(oldBatch&&!newBatch&&!reduced){oldBatch.inert=true;document.body.append(oldBatch);oldBatch.animate([{opacity:1,translate:'0 0'},{opacity:0,translate:'0 140%'}],{duration:300,easing:'cubic-bezier(.4,0,.7,.3)'}).finished.finally(()=>oldBatch.remove());}
  motion.header(before,page,previous);
  motion.screen(page,previous);
  if(page==='roll'&&(previous!=='roll'||motionRollId!==rollId||revealPhotos))motion.photos();
  motionRollId=page==='roll'?rollId:'';
  revealPhotos=false;
  if(page==='archive'){const note=root.querySelector('#archive-note');noteObserver=new ResizeObserver(fitArchiveNote);noteObserver.observe(note);fitArchiveNote();document.fonts.ready.then(fitArchiveNote);}
  if(page==='trash'&&trashPreview)drawTrashPreview();
  if(preservedSearch)root.querySelector('.topbar')?.replaceWith(preservedSearch);
  observer=new IntersectionObserver(entries=>entries.forEach(({isIntersecting,target})=>{if(isIntersecting){loadPhoto(target);observer.unobserve(target);}}),{rootMargin:'300px'});
  root.querySelectorAll('img[data-photo]').forEach(n=>{n.addEventListener('load',()=>{n.parentElement.classList.remove('broken');n.parentElement.classList.add('loaded');});n.addEventListener('error',()=>{n.parentElement.classList.add('broken');n.parentElement.querySelector('.photo-fallback').textContent='Не удалось прочитать JPEG';});if(n.complete&&n.naturalWidth){n.parentElement.classList.remove('broken');n.parentElement.classList.add('loaded');}observer.observe(n);});
  if(editorPages.includes(page))editor.mount();
  if(inlineMessage)toast(inlineMessage);
  if(focusId){const input=document.getElementById(focusId);input?.focus();if(input?.type==='search' && cursor!=null)input.setSelectionRange(cursor,cursor);}
}
async function loadPhoto(img) {
  if(img.hasAttribute('src'))return;
  const f=rolls.flatMap(r=>r.frames).find(f=>f.id===img.dataset.photo);if(!f)return;
  try{const url=await thumbnails.get(f,()=>img.isConnected);if(url&&img.isConnected)img.src=url;else if(!url&&img.isConnected)loadPhoto(img);}
  catch{if(!img.isConnected)return;img.parentElement.classList.add('broken');img.parentElement.querySelector('.photo-fallback').textContent='Фотография недоступна';img.dispatchEvent(new Event('photo-ready'));}
}
function clearSourceFiles(sourceId) {
  for(const [id,url]of urls)if(id.startsWith(sourceId+'/')){URL.revokeObjectURL(url);urls.delete(id);}
  for(const id of files.keys())if(id.startsWith(sourceId+'/'))files.delete(id);
}
async function walk(dir,prefix='') {
  const result=[];
  for await(const [name,entry] of dir.entries()) {
    if(entry.kind==='directory')result.push(...await walk(entry,prefix+name+'/'));
    else if(isJPEG(name)){const file=await entry.getFile();result.push({path:prefix+name,name,file,size:file.size,modified:file.lastModified});}
  }
  return result;
}
async function ingest(entries,source) {
  const savedRolls=demo ? (await read('archive').catch(()=>null))?.rolls || [] : rolls;
  const next=groupFiles(entries,source,savedRolls);
  for(const r of next){const extra=savedRolls.find(old=>old.id===r.id)?.frames.filter(f=>f.persisted||f.sourceFrameId)||[];r.frames.push(...extra);}
  const importedFiles=new Map(next.flatMap(r=>r.frames.filter(f=>f.persisted).map(f=>[f.id,files.get(f.id)])));
  clearSourceFiles(source.id);
  for(const [id,file]of importedFiles)if(file)files.set(id,file);
  entries.filter(f=>isJPEG(f.name)).forEach(f=>files.set(`${source.id}/${f.path}`,f.file));
  if(demo){rolls=savedRolls;demo=false;selected.clear();selecting=false;}
  rolls=[...rolls.filter(r=>r.sourceId!==source.id),...next];
  if(!sources.some(s=>s.id===source.id))sources.push(source);else sources=sources.map(s=>s.id===source.id?source:s);
  handles.set(source.id,handles.get(source.id)||null);
  // Null marks a directory uploaded for this session; it still has usable File objects.
  selected=pruneSelection(selected,rolls);
  await save();
  return next;
}
async function run(task,label='Загружаем фотографии…') {
  if(busy)return;busy=true;busyLabel=label;render();
  try {await task();} catch(error){if(error.name!=='AbortError')toast(error.name==='QuotaExceededError'?'В браузере недостаточно места для фотографий. Загрузите меньше файлов.':error.name==='NotAllowedError'?'Нет доступа к папке. Подключите её снова.':(native?error.message:'Не удалось прочитать папку. Проверьте доступ и повторите.'));}
  finally{busy=false;render();}
}
async function connect(reconnectId=null) {
  if(native){await openNativeFolder();return;}
  if(busy)return;
  if(!('showDirectoryPicker' in window)||(reconnectId&&sources.find(s=>s.id===reconnectId)?.mode!=='persistent')){pickerSource=reconnectId;picker.value='';picker.click();return;}
  await run(async()=>{
    const handle=await window.showDirectoryPicker({mode:'read'});
    let source=sources.find(s=>s.id===reconnectId);
    if(!source){for(const s of sources){const h=handles.get(s.id)||await read('handle:'+s.id).catch(()=>null);if(h && await h.isSameEntry(handle)){source=s;break;}}}
    source=source||{id:crypto.randomUUID(),name:handle.name};
    const entries=await walk(handle);
    source={...source,name:handle.name,mode:'persistent'};
    handles.set(source.id,handle);
    const next=await ingest(entries,source);
    try{await write('handle:'+source.id,handle);}catch{toast('Папка открыта. После перезапуска потребуется подключить её снова.');}
    archiveFilter={query:'',film:'',period:'',incomplete:false};go('archive');
    if(!next.length)toast('В папке не найдено JPEG. Выберите другую папку.');
  });
}
picker.addEventListener('change',()=>run(async()=>{
  const chosen=[...picker.files];if(!chosen.length)return;
  const name=chosen[0].webkitRelativePath.split('/')[0];
  const entries=chosen.map(file=>({file,name:file.name,path:file.webkitRelativePath.split('/').slice(1).join('/'),size:file.size,modified:file.lastModified}));
  if(pickerSource){const source={...(sources.find(s=>s.id===pickerSource)||{id:crypto.randomUUID()}),name,mode:'session'};pickerSource=null;await ingest(entries,source);go('archive');}
  else await importPhotos(entries,name,true);
}));
photosPicker.addEventListener('change',()=>run(async()=>{
  const entries=[...photosPicker.files].map(file=>({file,name:file.name,path:file.name,size:file.size,modified:file.lastModified}));
  if(entries.length)await importPhotos(entries,'Новая плёнка',false,uploadTarget);
}));
async function importPhotos(entries,name,folders=false,target=null) {
  const valid=entries.filter(f=>isJPEG(f.name));
  if(!valid.length){toast('Выберите фотографии в формате JPEG.');return;}
  if(page==='metadata'&&(editId||pending[0]))target=editId||pending[0];
  const base=demo?realRolls:rolls;
  const source={id:crypto.randomUUID(),name,mode:'stored'};
  let next, newRolls, additions;
  if(target){
    const r=base.find(r=>r.id===target);if(!r)throw new Error('Плёнка не найдена');
    additions=appendPhotos(r,valid,()=>crypto.randomUUID());
    if(!additions.length){toast('Эти фотографии уже есть в плёнке.');return;}
    newRolls=[];next=base.map(old=>old.id===target?{...old,frames:[...old.frames,...additions.map(({file,...frame})=>frame)]}:old);
  }else{
    const normalized=valid.map((v,i)=>({...v,path:folders?v.path:`${i}/${v.name}`}));
    if(folders)newRolls=groupFiles(normalized,source);
    else newRolls=[{id:source.id+'/',sourceId:source.id,folder:'',title:name,number:'',film:'',date:'',description:'',frames:valid.map((v,i)=>({id:source.id+'/'+i,name:v.name,path:String(i),size:v.size,modified:v.modified,viewed:false,rating:0,rejected:false}))}];
    for(const r of newRolls){Object.assign(r,folders?uploadFolderMetadata(r.folder.split('/').pop()||name):{title:'',number:'',film:'',iso:''});}
    if(combined&&newRolls[0])Object.assign(newRolls[0],Object.fromEntries(Object.entries(draft).filter(([,v])=>v!=='')));
    draft={};
    additions=[];const byPath=new Map(valid.map(v=>[v.path,v]));
    for(const r of newRolls)for(const f of r.frames){f.persisted=true;const v=folders?byPath.get(f.path):valid[Number(f.path)];additions.push({...f,file:v.file});}
    next=[...base,...newRolls];
  }
  const nextSources=target?sources:[...sources,source];
  const nextPending=target?pending:newRolls.map(r=>r.id);
  const staging=!target||pending.includes(target)||target===editId;
  if(staging){beginUpload();additions.forEach(f=>uploadSession.frames.add(f.id));}
  else await writeBatch([...additions.map(f=>['photo:'+f.id,f.file]),['archive',{sources:nextSources,rolls:next,demo:false,lastRoll,openedRolls:[...openedRolls],pending:[],selected:[...selected],selecting}]]);
  sources=nextSources;rolls=next;if(!staging)realRolls=next;demo=false;pending=nextPending;
  additions.forEach(f=>files.set(f.id,f.file));
  if(!target){selected.clear();selecting=false;archiveFilter={query:'',film:'',period:'',incomplete:false};go('metadata');}
  else if(pending.includes(target)||target===editId){go('metadata');}
  else {frameFilter={query:'',unseen:false,rating:''};go('roll',target);}
}
root.addEventListener('submit',async event=>{
  if(event.target.id!=='metadata-form')return;
  event.preventDefault();const data=new FormData(event.target);
  const id=pending[0]||editId;const r=rolls.find(r=>r.id===id);if(!r){toast('Сначала загрузите фотографии или папку.');return;}
  const title=String(data.get('title')||'').trim();
  const start=String(data.get('dateStart')||''),end=String(data.get('dateEnd')||'');
  if(!validPeriod(start,end)){toast('Окончание съёмки не может быть раньше начала.');return;}
  const updated={...r,title,number:String(data.get('number')||'').trim(),iso:String(data.get('iso')||'').trim(),frameFormat:String(data.get('frameFormat')||''),film:String(data.get('film')).trim(),description:r.description||'',dateStart:start,dateEnd:end,date:start,namingVersion:2,fileNameAuto:event.target.elements.fileName.dataset.auto==='true',fileName:String(data.get('fileName')||'').trim()};
  const next=rolls.map(r=>r.id===id?updated:r),nextPending=pending.filter(p=>p!==id);
  try{
    if(native&&uploadSession?.token){
      const committed=await native.commitUpload(uploadSession.token,updated,updated.fileName||filenameStem(updated));
      const remaining=next.filter(r=>nextPending.includes(r.id));
      sources=[...committed.sources,...sources.filter(source=>remaining.some(r=>r.sourceId===source.id)&&!committed.sources.some(x=>x.id===source.id))];
      rolls=[...committed.rolls,...remaining];demo=false;
    }else if(native){
      await write('archive',{sources,rolls:next,demo:false,lastRoll,openedRolls:[...openedRolls],pending:[],selected:[...selected],selecting});applyNativeArchive(await native.renameRoll(id,{stem:updated.fileName||filenameStem(updated),renameFolder:true}));
    }else{
      updated.frames.forEach((f,i)=>f.name=numberedFilename(updated.fileName||filenameStem(updated),i+1));
      const committed=next.filter(r=>!nextPending.includes(r.id)),committedSources=sources.filter(source=>committed.some(r=>r.sourceId===source.id));
      await writeBatch([...updated.frames.filter(f=>files.has(f.id)).map(f=>['photo:'+f.id,files.get(f.id)]),['archive',{sources:committedSources,rolls:committed,demo:false,lastRoll,openedRolls:[...openedRolls],pending:[],selected:[...selected],selecting}]]);
      rolls=next;demo=false;
    }
    pending=nextPending;realRolls=rolls.filter(r=>!pending.includes(r.id));updateUploadBase();
    if(!pending.length){const tokens=uploadSession?.tokens||[];uploadSession=null;combined=false;if(native)for(const token of tokens)await native.cancelUpload(token);}
    const edited=editId;editId='';draft={};go(pending.length?'metadata':edited?'roll':'archive',edited);
  }catch(error){toast(error.message||'Не удалось сохранить данные. Попробуйте ещё раз.');}

});
root.addEventListener('dragover',event=>{if(event.target.closest('[data-drop-zone]')){event.preventDefault();event.target.closest('[data-drop-zone]').classList.add('dragging');}});
root.addEventListener('dragleave',event=>{event.target.closest('[data-drop-zone]')?.classList.remove('dragging');});
root.addEventListener('drop',event=>{
  if(!event.target.closest('[data-drop-zone]'))return;event.preventDefault();if(native){const paths=[...event.dataTransfer.files].map(file=>native.pathForFile(file)).filter(Boolean);if(paths.length)openNativeUpload(paths);return;}
  const items=[...event.dataTransfer.items].map(i=>i.webkitGetAsEntry?.()).filter(Boolean);
  const dropped=[...event.dataTransfer.files];
  run(async()=>{
    const entries=[];
    async function traverse(entry,prefix=''){
      if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));entries.push({file,name:file.name,path:prefix+file.name,size:file.size,modified:file.lastModified});}
      else {const reader=entry.createReader();let batch;do{batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));for(const child of batch)await traverse(child,prefix+entry.name+'/');}while(batch.length);}
    }
    if(items.length){for(const entry of items)await traverse(entry);}else for(const file of dropped)entries.push({file,name:file.name,path:file.name,size:file.size,modified:file.lastModified});
    await importPhotos(entries,items.find(i=>i.isDirectory)?.name||'Новая плёнка',items.some(i=>i.isDirectory));
  },'Загружаем фотографии…');
});
async function refresh() {
  if(native){await run(async()=>{applyNativeArchive(await native.refresh());},'Обновляем папки…');return;}
  if(demo){return;}
  if(!sources.length){await connect();return;}
  const reconnect=sources.find(s=>s.mode!=='stored'&&s.mode!=='desktop'&&!handles.get(s.id));
  if(reconnect){await connect(reconnect.id);return;}
  await run(async()=>{for(const s of sources.filter(s=>s.mode!=='stored')){const h=handles.get(s.id);if(await h.requestPermission({mode:'read'})!=='granted'){handles.delete(s.id);throw new DOMException('Permission denied','NotAllowedError');}await ingest(await walk(h),s);}},'Обновляем архив…');
}
async function restoreReal() {const data=await read('archive').catch(()=>null);rolls=data?.rolls||[];demo=false;selected.clear();selecting=false;await save();go('archive');}
root.addEventListener('click',async event=>{
  const option=event.target.closest('[data-film-option]');
  if(option){const input=document.querySelector('#film-input');input.value=option.dataset.filmOption;draft.film=input.value;document.querySelector('#film-suggestions').hidden=true;input.setAttribute('aria-expanded','false');input.focus();return;}
  const trashCard=event.target.closest('[data-trash-frame]');
  if(trashCard&&!restoring){const id=trashCard.dataset.trashFrame;if(!trashSelecting){trashPreview=id;render();return;}trashSelection=selectFrame(trashSelection,id,trashedFrames(current()).map(f=>f.id),trashAnchor,event.shiftKey);trashAnchor=id;render();root.querySelector(`[data-trash-frame="${CSS.escape(id)}"]`)?.focus();return;}
  const photoAction=event.target.closest('[data-action="photo-select"],[data-action="photo-favorite"],[data-action="photo-delete"]');
  if(photoAction){const f=activeFrames(current()).find(f=>f.id===photoAction.dataset.id);if(!f)return;
    if(photoAction.dataset.action==='photo-select'){selected=selectFrame(selected,f.id,visibleFrames().map(f=>f.id),anchor,event.shiftKey);anchor=f.id;selecting=selected.size>0;preserveAlbumFrames=true;render();await save();}
    if(selecting&&photoAction.dataset.action!=='photo-select')return;
    if(photoAction.dataset.action==='photo-favorite'){current().workStarted=true;f.favorite=!f.favorite;render();await save();}
    if(photoAction.dataset.action==='photo-delete')await deleteAlbumFrames([f.id]);return;
  }
  const card=event.target.closest('[data-frame]');
  if(card){const id=card.dataset.frame;if(!selecting){openFrame(id);return;}selecting=true;selected=selectFrame(selected,id,visibleFrames().map(f=>f.id),anchor,event.shiftKey);anchor=id;selecting=selected.size>0;preserveAlbumFrames=true;render();root.querySelector(`[data-frame="${CSS.escape(id)}"]`)?.focus({preventScroll:true});await save();return;}
  const el=event.target.closest('[data-action]');if(!el)return;
  switch(el.dataset.action){
    case 'roll-complete':if(!selecting){const r=current();r.completed=!r.completed;if(!r.completed)r.workStarted=true;await save();render();}break;
    case 'album-layout':revealPhotos=albumLayout!==el.dataset.layout;albumLayout=el.dataset.layout;albumLayouts.set(rollId,albumLayout);render();break;
    case 'batch-favorite':current().workStarted=true;activeFrames(current()).filter(f=>selected.has(f.id)).forEach(f=>f.favorite=true);selected.clear();selecting=false;await save();render();break;
    case 'batch-delete':await deleteAlbumFrames([...selected],true);break;
    case 'batch-cancel':selected.clear();selecting=false;await save();render();break;
    case 'disconnect-roll':{const r=current();if(native){applyNativeArchive(await native.disconnect(r.sourceId));}else{rolls=rolls.filter(x=>x.id!==r.id);if(!demo)realRolls=rolls;await save();}selected.clear();selecting=false;go('archive');break;}
    case 'connect':await connect();break;
    case 'connect-once':pickerSource=null;picker.value='';picker.click();break;
    case 'reconnect':await connect(el.dataset.source);break;
    case 'refresh':await refresh();break;
    case 'demo':demo=true;rolls=demoRolls();lastRoll='';selected.clear();selecting=false;await save();go('archive');break;
    case 'real':await restoreReal();break;
    case 'upload':discardUpload();combined=true;editId='';go('upload');break;
    case 'cancel-upload':cancelUpload();break;
    case 'favorites':if(selecting)break;frameFilter.favorites=!frameFilter.favorites;revealPhotos=true;render();break;
    case 'choose':if(busy)break;if(native){await pickNativeUpload();break;}uploadUI.togglePicker();break;
    case 'choose-photos':uploadUI.closePicker();uploadTarget=editId||pending[0]||null;photosPicker.value='';photosPicker.click();break;
    case 'choose-folder':uploadUI.closePicker();if(native){await pickNativeUpload();break;}pickerSource=null;picker.value='';picker.click();break;
    case 'append':if(native){await refresh();break;}uploadTarget=rollId;photosPicker.value='';photosPicker.click();break;
    case 'view':{const list=visibleFrames();const f=list.find(f=>f.id===current().lastFrameId)||list[0];if(f)openFrame(f.id);break;}
    case 'split-selected':{if(canSplit(current())){const f=activeFrames(current()).find(f=>selected.has(f.id)&&!f.sourceFrameId);if(f)openFrame(f.id,'split');else toast('Выберите неразделённые сканы.');}break;}
    case 'trash':if(native){await native.showTrash();break;}go('trash',rollId);break;
    case 'trash-back':go('roll',rollId);break;
    case 'trash-select':trashSelecting=!trashSelecting;trashSelection.clear();render();break;
    case 'trash-close':trashPreview='';render();break;
    case 'trash-clear':trashSelection.clear();render();break;
    case 'trash-restore':await restoreTrashSelection();break;
    case 'edit-metadata':beginUpload();rolls=structuredClone(rolls);draft={};combined=true;editId=rollId;go('metadata');break;
    case 'archive':archiveFilter.incomplete=false;frameFilter={query:'',unseen:false,rating:''};go('archive');break;
    case 'resume':{const r=rolls.find(r=>r.id===lastRoll)||rolls[0];if(r)go('roll',r.id);break;}
    case 'incomplete':archiveFilter.incomplete=true;go('archive');break;
    case 'all-rolls':archiveFilter.incomplete=false;render();break;
    case 'reset-archive':archiveFilter={query:'',film:'',period:'',incomplete:false};render();break;
    case 'film':archiveFilter.film=archiveFilter.film===el.dataset.film?'':el.dataset.film;go('archive');break;
    case 'select-mode':selecting=!selecting;if(!selecting)selected.clear();render();await save();break;
    case 'clear':selected.clear();anchor='';render();await save();break;
    case 'select-all':{const frames=visibleFrames();if(frames.length&&frames.every(f=>selected.has(f.id))){selected.clear();selecting=false;}else{frames.forEach(f=>selected.add(f.id));selecting=true;}render();await save();break;}
    case 'all-frames':frameFilter.unseen=false;render();break;
    case 'unseen':frameFilter.unseen=!frameFilter.unseen;render();break;
    case 'reset-frames':frameFilter={query:'',unseen:false,rating:''};render();break;
  }
});
root.addEventListener('input',event=>{if(event.target.id==='archive-note'){fitArchiveNote();try{localStorage.setItem('plenka-archive-note',event.target.value);}catch{toast('Не удалось сохранить заметку.');}return;}if(event.target.id==='film-input')suggestFilms(event.target);if(event.target.closest('#metadata-form')&&event.target.name)draft[event.target.name]=event.target.type==='checkbox'?event.target.checked:event.target.value;if(event.target.id==='query'){(page==='roll'?frameFilter:archiveFilter).query=event.target.value;render('query');}});
root.addEventListener('change',event=>{
  if(event.target.closest('#metadata-form')&&event.target.name)draft[event.target.name]=event.target.type==='checkbox'?event.target.checked:event.target.value;
  if(!['film-filter','period-filter','rating-filter'].includes(event.target.id))return;
  if(event.target.id==='film-filter')archiveFilter.film=event.target.value;
  if(event.target.id==='period-filter')archiveFilter.period=event.target.value;
  if(event.target.id==='rating-filter')frameFilter.rating=event.target.value;
  if(event.target.id!=='rating-filter'&&page!=='archive')go('archive');else render(event.target.id);
});
function suggestFilms(input){
  const list=document.querySelector('#film-suggestions'),q=input.value.trim().toLowerCase();
  const names=[...new Set([...filmNames,...rolls.map(r=>r.film).filter(Boolean)])].filter(f=>f.toLowerCase().includes(q)).slice(0,7);
  list.innerHTML=names.map((f,i)=>`<button type="button" role="option" id="film-option-${i}" aria-selected="false" data-film-option="${e(f)}">${e(f)}</button>`).join('');
  list.hidden=!names.length;input.setAttribute('aria-expanded',String(!list.hidden));input.removeAttribute('aria-activedescendant');
}
root.addEventListener('focusin',event=>{if(event.target.id==='film-input')suggestFilms(event.target);});
root.addEventListener('keydown',event=>{
  if(event.target.id!=='film-input')return;
  const list=document.querySelector('#film-suggestions'),options=[...list.children];if(list.hidden)return;
  const index=options.findIndex(n=>n.getAttribute('aria-selected')==='true');
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const next=event.key==='ArrowDown'?(index+1)%options.length:(index<=0?options.length-1:index-1);options.forEach((n,i)=>n.setAttribute('aria-selected',String(i===next)));event.target.setAttribute('aria-activedescendant',options[next].id);}
  if(event.key==='Enter'&&index>=0){event.preventDefault();options[index].click();}
  if(event.key==='Escape'){list.hidden=true;event.target.setAttribute('aria-expanded','false');}
});
root.addEventListener('focusout',event=>{if(event.target.id==='film-input'&&!event.relatedTarget?.closest('#film-suggestions')){document.querySelector('#film-suggestions').hidden=true;event.target.setAttribute('aria-expanded','false');}});
function cancelUpload(){const target=editId;discardUpload();editId='';go(target?'roll':'archive',target);}
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented||document.querySelector('dialog[open]'))return;
  if(event.key==='Escape'){
    event.preventDefault();
    if(editorPages.includes(page))return;
    if(page==='trash'){if(trashPreview){trashPreview='';render();}else if(trashSelecting){trashSelecting=false;trashSelection.clear();render();}else go('roll',rollId);return;}
    if(['upload','metadata'].includes(page)){cancelUpload();return;}
    if(page==='roll'){if(selecting){selected.clear();selecting=false;render();save();}else{frameFilter={query:'',unseen:false,rating:''};go('archive');}return;}
    if(page==='archive')document.activeElement?.blur();
    return;
  }
  if(page!=='roll'||event.target.closest('input,select,textarea'))return;
  if((event.ctrlKey||event.metaKey)&&(event.key.toLowerCase()==='a'||event.code==='KeyA')){event.preventDefault();visibleFrames().forEach(f=>selected.add(f.id));selecting=true;render();save();}
});

window.addEventListener('hashchange',route);
document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();const main=document.querySelector('#main');main?.setAttribute('tabindex','-1');main?.focus();});
async function init() {
  try {
    if(native){applyNativeArchive(await read('archive'));pending=[];history.replaceState(null,'','#archive');route();archivePrepared();return;}
    const reset=await resetOnce('user-reset-ndzd-iteration-3-release');
    if(reset)history.replaceState(null,'','#archive');
    const data=await read('archive');
    // Older builds saved unconfirmed imports as pending archive entries.
    if(data?.pending?.length){const unconfirmed=new Set(data.pending),abandoned=(data.rolls||[]).filter(r=>unconfirmed.has(r.id));data.rolls=(data.rolls||[]).filter(r=>!unconfirmed.has(r.id));data.sources=(data.sources||[]).filter(source=>data.rolls.some(r=>r.sourceId===source.id));data.pending=[];await write('archive',data);await removeKeys(abandoned.flatMap(r=>r.frames.map(f=>'photo:'+f.id)));}
    for(const r of data?.rolls||[])for(const f of r.frames){if(f.favorite===undefined)f.favorite=!!f.rating;if(f.splitHidden)f.splitHidden=false;if(f.sourceFrameId)f.name=f.name.replace(/_A(?=\.jpe?g$)/i,'_l').replace(/_B(?=\.jpe?g$)/i,'_r');}
    if(data){sources=data.sources||[];realRolls=data.rolls||[];demo=!!data.demo;rolls=demo?demoRolls():realRolls;lastRoll=data.lastRoll||'';openedRolls=new Set(data.openedRolls||[]);pending=data.pending||[];selected=pruneSelection(new Set(data.selected||[]),rolls);selecting=!!data.selecting;}
    for(const r of rolls)for(const f of r.frames)if(f.persisted){const blob=await read('photo:'+f.id);if(blob)files.set(f.id,blob);}
    for(const source of sources.filter(s=>s.mode!=='stored')){const handle=await read('handle:'+source.id);if(handle&&await handle.queryPermission({mode:'read'})==='granted'){handles.set(source.id,handle);if(!demo){const entries=await walk(handle);await ingest(entries,source);}}}
  } catch {toast('Архив не удалось восстановить полностью. Подключите папку снова.');}
  if(!location.hash || location.hash==='#welcome')history.replaceState(null,'','#archive');
  route();
  archivePrepared();
}

function applyNativeArchive(data){
 sources=data.sources||[];rolls=data.rolls||[];realRolls=rolls;demo=false;
 lastRoll=data.lastRoll||lastRoll;openedRolls=new Set(data.openedRolls||[...openedRolls]);
 thumbnails.clear();for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();
}
async function openNativeFolder(){
 await run(async()=>{const result=await native.openFolder();if(!result)return;
  applyNativeArchive(result.archive);const added=rolls.filter(r=>r.sourceId===result.sourceId);
  if(!added.length){toast('В папке нет JPEG-фотографий');return;}
  for(const r of added.filter(r=>r.frames.some(f=>!f.importRenamed))){const source=sources.find(s=>s.id===r.sourceId);Object.assign(r,uploadFolderMetadata(r.folder?.split('/').pop()||source?.name||''));}pending=added.filter(r=>r.frames.some(f=>!f.importRenamed)).map(r=>r.id);combined=false;draft={};editId='';
  await save();go(pending.length?'metadata':'roll',pending.length?'':added[0].id);
 },'Открываем папку…');
}
async function saveNativeImage(f){
 const next=await native.saveImage(f.id,structuredClone(f.edits||{}));Object.assign(f,next);thumbnails.clear();await save();
}
async function splitNative(f){
 const children=await native.split(f.id,structuredClone(f.edits||{}));const r=current();r.frames.splice(r.frames.indexOf(f)+1,0,...children);await save();thumbnails.clear();return children;
}
async function removeNative(f,{persist=true}={}){await native.remove(f.id);const r=current();r.workStarted=true;r.frames=r.frames.filter(x=>x.id!==f.id);thumbnails.evict(f.id);if(persist)await save();}
async function renameNative(f){
 const name=await askFileName(f.name);if(name===null)return;Object.assign(f,await native.rename(f.id,name));await save();
}
function askFileName(name){return new Promise(resolve=>{
 const modal=document.createElement('dialog');modal.className='rename-dialog';modal.innerHTML=`<form method="dialog"><label>Имя фотографии<input name="filename" required maxlength="180" value="${e(name)}"></label><div class="actions"><button class="button" value="cancel" formnovalidate>Отмена</button><button class="button primary" value="save">Сохранить</button></div></form>`;
 document.body.append(modal);modal.addEventListener('close',()=>{const value=modal.returnValue==='save'?modal.querySelector('input').value:null;modal.remove();resolve(value);},{once:true});modal.showModal();modal.querySelector('input').select();
 });}
if(native){
 document.body.classList.add('desktop-app');const action=async name=>{try{if(name==='archive')go('archive');if(name==='open')await openNativeFolder();if(name==='refresh')await refresh();if(['undo','redo'].includes(name)){if(document.activeElement?.closest('input:not([type=range]),textarea')||!editorPages.includes(page))document.execCommand(name);else await editor.command(name);}if(name==='save'&&editorPages.includes(page))await editor.command('save-file');}catch(error){toast(error.message);}};
 native.onMenu(action);
}

let archivePrepared;
const archiveReady=new Promise(resolve=>{archivePrepared=resolve;});
startSplash();
init();

function startSplash(){
  const splash=document.querySelector('#startup-splash');
  const photo=splash.querySelector('.startup-photo');
  root.inert=true;
  // The scan includes a paper border. Keep its horizon at source y=64.76%.
  function fitPhoto(){
    const width=splash.clientWidth,height=splash.clientHeight;
    const horizon=10+(height-20)*2/3;
    const scale=Math.max(width/920,horizon/(445-24),(height-horizon)/(657-445));
    photo.style.width=1024*scale+'px';photo.style.height=687*scale+'px';
    photo.style.left=(width-1024*scale)/2+'px';photo.style.top=horizon-445*scale+'px';
  }
  const resize=new ResizeObserver(fitPhoto);resize.observe(splash);fitPhoto();
  return new Promise(resolve=>{
    let done=false;
    const finish=()=>{if(done)return;done=true;resize.disconnect();splash.remove();root.inert=false;resolve();};
    splash.addEventListener('animationend',event=>{if(event.animationName==='startup-exit')finish();});
    Promise.all([photo.decode().catch(()=>{}),document.fonts.ready,archiveReady]).then(()=>{
      if(done)return;
      splash.classList.add('playing');
      // A fallback for tabs that suspend animation events.
      setTimeout(finish,6500);
    });
  });
}

root.addEventListener('wheel',event=>{const scroller=event.target.closest('.archive-scroll');if(!scroller||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;if(scroller.scrollWidth<=scroller.clientWidth)return;event.preventDefault();scroller.scrollLeft+=event.deltaY*(event.deltaMode===1?20:1);},{passive:false});

async function pickNativeUpload(){await openNativeUpload();}
async function openNativeUpload(paths){
 const epoch=uploadEpoch;
 await run(async()=>{const result=paths?await native.openPaths(paths):await native.pickUpload();if(!result)return;
  if(epoch!==uploadEpoch){await native.cancelUpload(result.token);return;}
  const added=result.archive.rolls,target=editId||pending[0];
  if(!added.length){await native.cancelUpload(result.token);toast('Нет новых фотографий JPEG');return;}
  beginUpload();uploadSession.tokens.push(result.token);uploadSession.token??=result.token;
  if(target){const r=rolls.find(r=>r.id===target);const known=new Set(r.frames.map(f=>f.id));r.frames=[...r.frames,...added.flatMap(r=>r.frames).filter(f=>!known.has(f.id))];render();return;}
  for(const r of added){const source=result.archive.sources.find(s=>s.id===r.sourceId);if(!r.frames.some(f=>f.importRenamed))Object.assign(r,r.importedFiles?{title:'',number:'',film:'',iso:''}:uploadFolderMetadata(r.folder?.split('/').pop()||source?.name||''));}
  Object.assign(added[0],Object.fromEntries(Object.entries(draft).filter(([,v])=>v!=='')));
  rolls=[...(demo?realRolls:rolls),...added];sources=[...sources,...result.archive.sources];demo=false;
  pending=added.map(r=>r.id);draft={};editId='';combined=true;go('metadata');
 },'Загружаем фотографии…');
}
