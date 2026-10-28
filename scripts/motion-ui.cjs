const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=process.env.NDZD_SMOKE_ROOT||path.resolve(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms));
let win,result=0;app.setPath('userData',path.join(os.tmpdir(),'ndzd-motion-'+process.pid));
app.whenReady().then(async()=>{try{
 let archive={sources:[{id:'source',mode:'desktop',name:'Тест'}],rolls:[{id:'roll',sourceId:'source',title:'Тест',frames:Array.from({length:8},(_,i)=>({id:'photo'+i,name:i+'.jpg',desktop:true}))}]};
 const bytes=await fs.readFile(path.join(root,'prototype-assets/lake.jpg'));
 ipcMain.handle('desktop:read',(_e,k)=>k==='archive'?archive:null);ipcMain.handle('desktop:write',(_e,k,v)=>{if(k==='archive')archive=v;});
 ipcMain.handle('desktop:disconnect',()=>{archive={sources:[],rolls:[]};return archive;});
 for(const name of ['bytes','thumbnail'])ipcMain.handle('desktop:'+name,()=>bytes);
 win=new BrowserWindow({show:false,width:1360,height:920,webPreferences:{preload:path.join(root,'desktop/preload.cjs'),contextIsolation:true,sandbox:true}});
 const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
 const js=code=>win.webContents.executeJavaScript(code,true);
 await win.loadFile(path.join(root,'index.html'));await wait(7400);
 assert.equal(await js("document.querySelector('.archive-shelf').classList.contains('is-empty')"),false);
 await js("window.brand=document.querySelector('header .archive-brand');window.brandRect=brand.getBoundingClientRect().toJSON();location.hash='#roll/roll'");
 await wait(65);assert.equal(await js("brand===document.querySelector('header .archive-brand')"),true);assert.equal(await js("document.querySelectorAll('header').length"),1);
 const rect=await js("brand.getBoundingClientRect().toJSON()");const before=await js('brandRect');assert.equal(rect.x,before.x);assert.equal(rect.width,before.width);assert.equal(rect.height,before.height);
 await wait(100);assert.equal(await js("document.querySelector('.header-controls').dataset.mode"),'roll');
 await wait(600);assert.equal(await js("document.querySelectorAll('.header-controls>.button').length"),3);assert.equal(await js("document.querySelectorAll('.route-header-out').length"),0);
 await js("document.querySelector('[data-layout=originals]').click()");await wait(50);
 const animations=await js("[...document.querySelectorAll('.album-frame')].map(f=>f.getAnimations().map(a=>({delay:a.effect.getTiming().delay,frames:a.effect.getKeyframes()}))).flat()");assert(animations.length>1);assert(animations.some(a=>a.delay>0));assert(animations.some(a=>a.frames[0].transform==='translateY(6px)'));
 await wait(1000);assert.equal(await js("[...document.querySelectorAll('.album-frame')].every(f=>getComputedStyle(f).opacity==='1')"),true);
 // Rapid reversals cannot leave duplicated headers or invisible controls behind.
 for(const route of ['archive','roll/roll','archive','roll/roll']){await js(`location.hash='#${route}'`);await wait(65);}
 await wait(650);assert.equal(await js("document.querySelectorAll('header').length"),1);assert.equal(await js("document.querySelectorAll('.header-controls>.button').length"),3);assert.equal(await js("document.querySelector('.header-controls').inert"),false);
 await fs.writeFile(path.join(__dirname,'../release/album-motion-check.png'),(await win.webContents.capturePage()).toPNG());
 await js("document.querySelector('[data-action=edit-metadata]').click()");await wait(80);assert.equal(await js("(()=>{const red=document.querySelector('.header-red');return red.getAnimations().some(a=>a.effect.getKeyframes()[0].width!==a.effect.getKeyframes()[1].width)})()"),true);await wait(450);assert.equal(await js("Math.abs(document.querySelector('.header-red').getBoundingClientRect().width-innerWidth)<2"),true);await js("document.querySelector('.upload-cancel').click()");await wait(500);
 await js("document.querySelector('[data-action=disconnect-roll]').click()");await wait(300);
 assert.equal(await js("document.querySelector('.archive-shelf').classList.contains('is-empty')"),true);
 assert.equal(await js("(()=>{const a=document.querySelector('.archive-add').getBoundingClientRect();return Math.abs(a.x+a.width/2-innerWidth/2)<2})()"),true);
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: stationary logo, single morphing header, staggered photo entrance, rapid reversals, plus returns to center after last disconnect.');
 }catch(e){console.error(e);result=1;}finally{win?.destroy();await fs.rm(app.getPath('userData'),{recursive:true,force:true});app.exit(result);}});
