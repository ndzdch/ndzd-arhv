// Integration test of the actual renderer, bridge and native Trash on disposable images.
const {app,BrowserWindow,ipcMain,shell}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),os=require('node:os');
const appRoot=process.env.NDZD_SMOKE_ROOT||path.resolve(__dirname,'..');
const {Library}=require(path.join(appRoot,'desktop/library.cjs'));
let temp,win;
app.setPath('userData',path.join(os.tmpdir(),'ndzd-smoke-user-'+process.pid));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{try{
 temp=await fs.mkdtemp(path.join(os.tmpdir(),'ndzd-ui-'));const photos=path.join(temp,'горный алтай');await fs.mkdir(photos);
 await fs.copyFile(path.join(appRoot,'prototype-assets/lake.jpg'),path.join(photos,'ndzd-smoke-'+process.pid+'.jpg'));
 const library=new Library(path.join(temp,'settings'),file=>shell.trashItem(file));await library.init();const c=await library.open(photos);c.root=(await fs.realpath(photos)).normalize('NFC');c.rolls[0].camera='Kodak H35N';await library.persist(c);
 let queue=Promise.resolve();const handlers={read:k=>library.read(k),write:(k,v)=>library.write(k,v),thumbnail:id=>library.thumbnail(id),bytes:id=>library.bytes(id),saveImage:(id,e)=>library.saveImage(id,e),split:(id,e)=>library.split(id,e),remove:id=>library.remove(id),rename:(id,n)=>library.rename(id,n),renameRoll:id=>library.renameRoll(id),refresh:()=>library.archive()};
 for(const [name,fn] of Object.entries(handlers))ipcMain.handle('desktop:'+name,(_e,...args)=>{const job=queue.then(()=>fn(...args));queue=job.catch(()=>{});return job;});
 win=new BrowserWindow({show:false,width:1360,height:920,webPreferences:{preload:path.join(appRoot,'desktop/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const errors=[];win.webContents.on('console-message',(_e,details)=>{if(details.level==='error')errors.push(details.message);});
 await win.loadFile(path.join(appRoot,'index.html'));await pause(7500);
 const js=code=>win.webContents.executeJavaScript(code,true);
 assert.equal(await js("document.querySelectorAll('.desktop-bar').length"),0);
 assert.equal(await js("document.querySelectorAll('.archive-card').length"),1);
 const r=c.rolls[0],f=r.frames[0];await js(`location.hash='#viewer/${r.id}/${f.id}'`);await pause(900);
 assert(await js("document.querySelector('.editor-picture canvas').width>0"));
 await js("document.querySelector('[data-action=editor-rotate]').click()");await pause(350);
 assert.equal(await js("document.querySelectorAll('.editor-file-actions,[data-action=editor-save-file],[data-action=editor-rename-file],[data-action=editor-show-file]').length"),0);
 win.webContents.send('desktop:menu','save');await pause(600);
 assert.equal(library.find(f.id).f.edits.turn,3);
 await js("document.querySelector('[data-action=editor-split]').click()");await pause(900);assert.equal(library.archive().rolls[0].frames.length,3);
 assert.equal(await js("document.querySelectorAll('.editor-thumb').length"),3);
 await fs.mkdir(path.join(__dirname,'../release'),{recursive:true});await fs.writeFile(path.join(__dirname,'../release/editor-check.png'),(await win.webContents.capturePage()).toPNG());
 const selectedId=await js("decodeURIComponent(location.hash.split('/').at(-1))");const child=library.archive().rolls[0].frames.find(x=>x.id===selectedId);assert(child&&child.id!==f.id,'split must open an independent half');await js("document.querySelector('[data-action=editor-delete]').click()");await pause(600);assert.equal(library.archive().rolls[0].frames.length,2);await assert.rejects(fs.access(path.join(photos,child.path)));await library.bytes(f.id);
 // Remove only this test-created Trash entry after verifying the native operation.
 const trashed=path.join(app.getPath('home'),'.Trash',child.name);try{await fs.unlink(trashed);}catch{}
 await js(`location.hash='#roll/${r.id}'`);await pause(600);assert.equal(await js("document.querySelectorAll('.album-frame').length"),2);assert(await js("[...document.querySelectorAll('.album-open img')].every(x=>x.naturalWidth>0)"));
 if(errors.length)throw Error(errors.join('\n'));console.log('PASS: renderer, thumbnails, rotation, full-size save, three real scans, macOS Trash.');
 }catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();if(temp)await fs.rm(temp,{recursive:true,force:true});await fs.rm(app.getPath('userData'),{recursive:true,force:true});app.exit(process.exitCode||0);}});
