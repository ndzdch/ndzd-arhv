const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=process.env.NDZD_SMOKE_ROOT||path.resolve(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms));
let win,result=0;app.setPath('userData',path.join(os.tmpdir(),'ndzd-album-'+process.pid));
app.whenReady().then(async()=>{try{
 let archive={sources:[{id:'source',mode:'desktop',name:'Тест'}],rolls:[{id:'roll',sourceId:'source',title:'Тест',frames:Array.from({length:6},(_,i)=>({id:'photo'+i,name:i+'.jpg',desktop:true}))}]};
 const bytes=await fs.readFile(path.join(root,'prototype-assets/lake.jpg'));
 ipcMain.handle('desktop:read',(_e,k)=>k==='archive'?archive:null);ipcMain.handle('desktop:write',(_e,k,v)=>{if(k==='archive')archive=v;});
 ipcMain.handle('desktop:disconnect',()=>{archive={sources:[],rolls:[]};return archive;});
 let reads=0;const deleted=[];ipcMain.handle('desktop:remove',(_e,id)=>{deleted.push(id);});
 for(const name of ['bytes','thumbnail'])ipcMain.handle('desktop:'+name,()=>{reads++;return bytes;});
 win=new BrowserWindow({show:false,width:1360,height:920,webPreferences:{preload:path.join(root,'desktop/preload.cjs'),contextIsolation:true,sandbox:true}});
 const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
 const js=code=>win.webContents.executeJavaScript(code,true);
 await win.loadFile(path.join(root,'index.html'));await wait(7400);
 await js("document.querySelector('.archive-category [data-action=incomplete]').click()");await wait(40);const timing=await js("[...document.querySelectorAll('.archive-tab-fill')].flatMap(n=>n.getAnimations().map(a=>a.effect.getTiming()))");assert.equal(timing.length,2);assert(timing.some(a=>a.delay===190));assert(timing.some(a=>a.delay===0&&a.duration===190));await wait(600);
 await js("document.querySelector('.archive-category [data-action=archive]').click()");await wait(40);const reverse=await js("[...document.querySelectorAll('.archive-tab-fill')].flatMap(n=>n.getAnimations().map(a=>({delay:a.effect.getTiming().delay,frames:a.effect.getKeyframes()})))");assert(reverse.some(a=>a.delay===190&&a.frames[0].clipPath.replaceAll('px','')==='inset(0 0 0 100%)'));assert(reverse.some(a=>a.delay===0&&a.frames.at(-1).clipPath.replaceAll('px','')==='inset(0 100% 0 0)'));await wait(550);
 await js("location.hash='#roll/roll'");await wait(1600);
 await js("window.stable=new Map([...document.querySelectorAll('.album-frame')].map(n=>[n.querySelector('[data-frame]').dataset.frame,{node:n,img:n.querySelector('img[data-photo]'),src:n.querySelector('img[data-photo]').src}]))");const beforeReads=reads;
 await js("document.querySelector('[data-id=photo0][data-action=photo-delete]').click()");await wait(200);assert.deepEqual(deleted,['photo0']);assert.equal(reads,beforeReads);
 assert.equal(await js("[...document.querySelectorAll('.album-frame')].every(n=>{const old=stable.get(n.querySelector('[data-frame]').dataset.frame);return n===old.node&&n.querySelector('img[data-photo]')===old.img&&old.img.src===old.src&&old.img.complete})"),true);
 assert.equal(await js("[...document.querySelectorAll('.album-frame')].some(n=>n.getAnimations().some(a=>a.effect.getKeyframes()[0].transform.startsWith('translate(')))"),true);await wait(500);
 await js("document.querySelector('[data-action=photo-select]').click()");await wait(200);assert.equal(await js("document.querySelector('#app [data-action=batch-cancel]')===null"),true);assert.equal(await js("document.querySelector('[data-action=select-all]').textContent"),'Выбрать все');await js("window.batch=document.querySelector('.album-batch');document.querySelector('[data-action=select-all]').click()");await wait(100);assert.equal(await js("batch===document.querySelector('.album-batch')"),true);assert.equal(await js("document.querySelector('[data-action=select-all]').textContent"),'Снять выделение');
 // Remove several exceptions after selecting the whole roll, with real pointer clicks.
 await js("window.selectionNodes=[...document.querySelectorAll('.album-frame')]");
 const click=async selector=>{const box=await js(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);const point={x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};win.webContents.sendInputEvent({type:'mouseMove',...point});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await wait(60);};
 for(const [i,id] of ['photo1','photo2','photo3'].entries()){
  await click(i===1?`[data-id=${id}][data-action=photo-select]`:`[data-frame=${id}]`);
  assert.equal(await js("document.querySelectorAll('.album-frame.is-selected').length"),4-i);
  assert.equal(await js(`getComputedStyle(document.querySelector('[data-id=${id}][data-action=photo-select]'),'::after').opacity`),'0');
 }
 assert.equal(await js("[...document.querySelectorAll('.album-frame')].every((n,i)=>n===selectionNodes[i])"),true);
 const favoriteStyle=()=>js("(()=>{const n=document.querySelector('.album-favorites');return [n.disabled,getComputedStyle(n).backgroundColor,getComputedStyle(n.querySelector('img')).filter]})()");const resting=await favoriteStyle();
 const headerBox=await js("document.querySelector('.album-favorites').getBoundingClientRect().toJSON()");win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(headerBox.x+headerBox.width/2),y:Math.round(headerBox.y+headerBox.height/2)});await wait(180);assert.deepEqual(await favoriteStyle(),resting);
 await js("document.querySelector('[data-action=batch-favorite]').click()");await wait(200);
 assert.deepEqual(archive.rolls[0].frames.filter(f=>f.favorite).map(f=>f.id),['photo4','photo5']);
 await js("document.querySelector('[data-action=photo-select]').click();document.querySelector('[data-action=select-all]').click()");await wait(100);
 await fs.writeFile(path.join(__dirname,'../release/selection-menu-check.png'),(await win.webContents.capturePage()).toPNG());
 await js("document.querySelector('[data-action=select-all]').click()");await wait(400);assert.equal(await js("document.querySelector('.album-batch')===null"),true);
 await js("document.querySelector('[data-action=photo-select]').click();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await wait(400);assert.equal(await js("document.querySelector('.album-batch')===null"),true);
 await js("document.querySelector('[data-action=photo-select]').click();document.querySelector('[data-action=batch-favorite]').click()");await wait(450);assert.equal(await js("document.querySelector('.album-batch')===null"),true);assert.equal(archive.rolls[0].frames[0].favorite,true);
 await js("document.querySelector('[data-action=favorites]').click()");await wait(80);assert.equal(await js("document.querySelectorAll('.album-frame').length"),3);assert.equal(await js("[...document.querySelectorAll('.album-frame')].some(n=>n.getAnimations().length>0)"),true);await wait(850);await js("location.hash='#archive'");await wait(200);await js("location.hash='#roll/roll'");await wait(1000);assert.equal(await js("document.querySelectorAll('.album-frame').length"),5);assert.equal(await js("document.querySelector('[data-action=favorites]').getAttribute('aria-pressed')"),'false');
 await js("document.querySelectorAll('[data-action=photo-select]')[0].click();document.querySelectorAll('[data-action=photo-select]')[1].click();document.querySelector('[data-action=batch-delete]').click()");await wait(600);assert.equal(deleted.length,3);assert.equal(reads,beforeReads);assert.equal(await js("document.querySelector('.album-batch')===null"),true);assert.equal(await js("[...document.querySelectorAll('[data-action=photo-favorite]')].every(n=>!n.disabled)"),true);
 await js("document.querySelector('.album-open').click()");await wait(400);await js("document.querySelector('[data-action=editor-delete]').click()");await wait(400);assert.equal(await js("document.querySelector('.toast,#notice,.inline-message')===null"),true);
 if(errors.length)throw Error(errors.join('\n'));console.log('PASS: sequential tab fills, retained photo/image nodes and URLs, no preview reload after single/batch deletion, smooth reflow, dynamic select-all label, deselection, Escape and automatic menu dismissal.');
 }catch(e){console.error(e);result=1;}finally{win?.destroy();await fs.rm(app.getPath('userData'),{recursive:true,force:true});app.exit(result);}});
