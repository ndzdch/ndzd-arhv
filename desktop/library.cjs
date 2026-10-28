const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const sharp = require('sharp');
const jpeg = name => /\.jpe?g$/i.test(name);
const cleanName = value => String(value || '').normalize('NFC').replace(/[\/:\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 180);
async function json(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch(e) { if(e.code==='ENOENT')return fallback;throw e; } }
async function atomic(file, data) { const temp=file+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});try {await fs.writeFile(temp,data,{flag:'wx'});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});} }
const exists = async file => {try{await fs.access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const frameKeys=['viewed','rating','favorite','edits','savedEdits'];
const rollKeys=['title','number','film','iso','camera','frameFormat','dateStart','dateEnd','date','description','lastFrameId','completed','workStarted','filenameYear','namingVersion','fileNameAuto','fileName','importedFiles'];
class Library {
  constructor(userData, trash) {this.userData=userData;this.trash=trash;this.catalogs=new Map();this.settings={};this.uploads=new Map();this.preview=false;}
  async init(){this.settings=await json(path.join(this.userData,'settings.json'),{});for(const root of this.settings.roots||[]){try{await this.open(root);}catch(e){this.settings.loadErrors??=[];this.settings.loadErrors.push(root+': '+e.message);}}}
  async settingsSave(){if(this.preview)return;await atomic(path.join(this.userData,'settings.json'),JSON.stringify(this.settings,null,2));}
  catalogFile(root){return path.join(root,'.ndzd','catalog.json');}
  async persist(c){if(this.preview)return;await atomic(this.catalogFile(c.root),JSON.stringify(c,null,2));}
  async open(folder){
    const root=await fs.realpath(folder);for(const existing of this.catalogs.keys())if(existing!==root&&(root.startsWith(existing+path.sep)||existing.startsWith(root+path.sep)))throw Error('Эта папка пересекается с уже открытой. Используйте «Обновить» для открытой папки.');if(!(await fs.stat(root)).isDirectory())throw Error('Выберите папку');
    let c=this.catalogs.get(root)||await json(this.catalogFile(root),null);
    if(!c)c={version:1,id:randomUUID(),root,rolls:[]};
    c.root=root;
    const groups=new Map();
    async function walk(dir,relative=''){for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.name.startsWith('.'))continue;const rel=path.join(relative,entry.name);if(entry.isDirectory())await walk(path.join(dir,entry.name),rel);else if(entry.isFile()&&jpeg(entry.name)){const stat=await fs.stat(path.join(dir,entry.name));const folder=path.dirname(rel)==='.'?'':path.dirname(rel);if(!groups.has(folder))groups.set(folder,[]);groups.get(folder).push({path:rel,name:entry.name,size:stat.size,modified:stat.mtimeMs});}}}
    await walk(root);
    for(const [folder,entries] of groups){let r=c.rolls.find(r=>r.folder===folder);if(!r){r={id:randomUUID(),sourceId:c.id,folder,title:path.basename(folder||root),frames:[]};c.rolls.push(r);}
      const found=new Set();for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}))){let f=r.frames.find(f=>f.path===entry.path);if(!f){f={id:randomUUID(),viewed:false,rating:0,favorite:false};r.frames.push(f);}Object.assign(f,entry,{deleted:false,missing:false});found.add(f.id);}for(const f of r.frames)if(!found.has(f.id)&&!f.deleted)f.missing=true;
    }
    for(const r of c.rolls)if(!groups.has(r.folder))for(const f of r.frames)if(!f.deleted)f.missing=true;
    await this.persist(c);this.catalogs.set(root,c);this.settings.roots=[...this.catalogs.keys()];await this.settingsSave();return c;
  }
  async openPaths(paths){
    const ids=[],individual=[];
    for(const file of paths){const stat=await fs.stat(file);if(stat.isDirectory()){const c=await this.open(file);ids.push(c.id);}else if(stat.isFile()&&jpeg(file))individual.push(file);}
    if(individual.length){const root=path.join(this.userData,'imports',randomUUID());await fs.mkdir(root,{recursive:true});for(const file of individual){let name=path.basename(file),index=1;while(await exists(path.join(root,name))){const p=path.parse(file);name=p.name+'-'+index+++p.ext;}await fs.copyFile(file,path.join(root,name));}const c=await this.open(root);for(const r of c.rolls){r.title='';r.importedFiles=true;}await this.persist(c);ids.push(c.id);}
    return {archive:this.archive(),sourceIds:ids};
  }
  async prepareUpload(paths){
    const staging=new Library(this.userData,this.trash);staging.preview=true;
    const fresh=[];for(const file of paths)fresh.push(await fs.realpath(file));
    const result=await staging.openPaths(fresh),token=randomUUID();this.uploads.set(token,staging);
    return {...result,token};
  }
  async commitUpload(token,data,stem){
    const staging=this.uploads.get(token);if(!staging)throw Error('Загрузка уже отменена');
    let entry;for(const c of staging.catalogs.values()){const r=c.rolls.find(r=>r.id===data.id);if(r){entry={c,r};break;}}
    if(!entry)for(const c of this.catalogs.values()){const r=c.rolls.find(r=>r.id===data.id);if(r){entry={c,r};break;}}
    if(!entry)throw Error('Папка загрузки недоступна');
    const {c:preview,r:original}=entry,r={...original,frames:[...original.frames]};for(const key of rollKeys)if(data[key]!==undefined)r[key]=data[key];
    const c=this.catalogs.get(preview.root)||{...preview,rolls:[]};
    const created=[];
    try{for(const incoming of data.frames||[]){if(r.frames.some(f=>f.id===incoming.id))continue;
      const source=this.find(incoming.id),relative=await this.freeName(c,r.folder||'',incoming.name);
      const destination=path.join(c.root,relative);await fs.copyFile(await this.disk(source.c,source.f.path),destination,require('node:fs').constants.COPYFILE_EXCL);created.push(destination);
      const stat=await fs.stat(destination);r.frames.push({...incoming,id:randomUUID(),sequence:undefined,part:undefined,derivedFrom:undefined,importRenamed:false,path:relative,name:path.basename(relative),size:stat.size,modified:stat.mtimeMs});
    }}catch(error){for(const file of created)await fs.rm(file,{force:true});throw error;}
    c.rolls=[...c.rolls.filter(old=>old.id!==r.id),r];this.catalogs.set(c.root,c);
    await this.persist(c);this.settings.roots=[...this.catalogs.keys()];await this.settingsSave();
    return this.renameRoll(r.id,{stem,renameFolder:data.namingVersion===2});
  }
  async cancelUpload(token){
    const staging=this.uploads.get(token);if(!staging)return;this.uploads.delete(token);
    const imports=path.resolve(this.userData,'imports')+path.sep;
    for(const root of staging.catalogs.keys())if(root.startsWith(imports)&&!this.catalogs.has(root))await fs.rm(root,{recursive:true,force:true});
  }
  async disconnect(id){for(const [root,c] of this.catalogs)if(c.id===id)this.catalogs.delete(root);this.settings.roots=[...this.catalogs.keys()];await this.settingsSave();return this.archive();}
  archive(){const old=this.settings.archive||{};return {...old,sources:[...this.catalogs.values()].map(c=>({id:c.id,name:path.basename(c.root),root:c.root,mode:'desktop'})),rolls:[...this.catalogs.values()].flatMap(c=>c.rolls.map(r=>({...r,frames:r.frames.filter(f=>!f.deleted&&!f.missing).map(f=>({...f,desktop:true}))}))),demo:false};}
  async read(key){return key==='archive'?this.archive():this.settings[key];}
  async write(key,value){if(key==='archive'){
    for(const c of this.catalogs.values()){for(const r of c.rolls){const incoming=value.rolls?.find(x=>x.id===r.id);if(!incoming)continue;for(const k of rollKeys)if(incoming[k]!==undefined)r[k]=incoming[k];for(const f of r.frames){const next=incoming.frames?.find(x=>x.id===f.id);if(next)for(const k of frameKeys)if(next[k]!==undefined)f[k]=next[k];}}await this.persist(c);}
    this.settings.archive={lastRoll:value.lastRoll,openedRolls:value.openedRolls,pending:value.pending,selected:value.selected,selecting:value.selecting};
  }else{if(!['editor-background-v2','archive-note'].includes(key))throw Error('Неизвестная настройка');this.settings[key]=value;}await this.settingsSave();}
  find(id){for(const c of this.catalogs.values())for(const r of c.rolls)for(const f of r.frames)if(f.id===id&&!f.deleted&&!f.missing)return {c,r,f};for(const staging of this.uploads.values()){try{return staging.find(id);}catch{}}throw Error('Фотография недоступна. Обновите папку.');}
  async disk(c,relative){const absolute=path.resolve(c.root,relative);if(!absolute.startsWith(c.root+path.sep))throw Error('Недопустимый путь');const real=await fs.realpath(absolute);if(real.normalize('NFC')!==absolute.normalize('NFC')||(await fs.lstat(absolute)).isSymbolicLink())throw Error('Ссылки на файлы не поддерживаются');return real;}
  async baseline(c,f){const backup=path.join('.ndzd','originals',f.id+'.jpg');return this.disk(c,await exists(path.join(c.root,backup))?backup:f.path);}
  async bytes(id){const {c,f}=this.find(id);return fs.readFile(await this.baseline(c,f));}
  async thumbnail(id){const {c,f}=this.find(id);return sharp(await this.baseline(c,f)).autoOrient().resize({width:600,height:600,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();}
  async render(id,edits={}){
    const {c,f}=this.find(id);let image=sharp(await this.baseline(c,f)).autoOrient().withMetadata({orientation:1});let buffer=await image.toBuffer();
    const turn=((Number(edits.turn)||0)%4+4)%4;if(turn)buffer=await sharp(buffer).rotate(turn*90).withMetadata({orientation:1}).toBuffer();
    const angle=Number(edits.angle)||0;if(!Number.isFinite(angle)||Math.abs(angle)>45)throw Error('Недопустимый угол');
    if(angle){const {width:w,height:h}=await sharp(buffer).metadata();const rad=angle*Math.PI/180,s=Math.max(Math.abs(Math.cos(rad))+h/w*Math.abs(Math.sin(rad)),Math.abs(Math.cos(rad))+w/h*Math.abs(Math.sin(rad)));const enlarged=await sharp(buffer).resize(Math.ceil(w*s),Math.ceil(h*s)).rotate(angle).withMetadata({orientation:1}).toBuffer();const m=await sharp(enlarged).metadata();buffer=await sharp(enlarged).extract({left:Math.floor((m.width-w)/2),top:Math.floor((m.height-h)/2),width:w,height:h}).withMetadata({orientation:1}).toBuffer();}
    if(edits.crop){const {width,height}=await sharp(buffer).metadata(),p=edits.crop;for(const k of ['x','y','w','h'])if(!Number.isFinite(p[k]))throw Error('Недопустимое кадрирование');if(p.x<0||p.y<0||p.w<=0||p.h<=0||p.x+p.w>1.00001||p.y+p.h>1.00001)throw Error('Недопустимое кадрирование');const left=Math.round(p.x*width),top=Math.round(p.y*height);buffer=await sharp(buffer).extract({left,top,width:Math.max(1,Math.min(width-left,Math.round(p.w*width))),height:Math.max(1,Math.min(height-top,Math.round(p.h*height)))}).withMetadata({orientation:1}).toBuffer();}
    return sharp(buffer).withMetadata({orientation:1}).jpeg({quality:98,chromaSubsampling:'4:4:4'}).toBuffer();
  }
  async saveImage(id,edits){const {c,f}=this.find(id),file=await this.disk(c,f.path),stat=await fs.stat(file);if(Math.abs(stat.mtimeMs-f.modified)>2||stat.size!==f.size)throw Error('Файл изменён вне приложения. Сначала обновите папку.');const buffer=await this.render(id,edits),backup=path.join(c.root,'.ndzd','originals',f.id+'.jpg');await fs.mkdir(path.dirname(backup),{recursive:true});try{await fs.copyFile(file,backup,require('node:fs').constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}await atomic(file,buffer);const next=await fs.stat(file);Object.assign(f,{edits,savedEdits:structuredClone(edits),size:next.size,modified:next.mtimeMs});await this.persist(c);return structuredClone(f);}
  async freeName(c,folder,name){const parsed=path.parse(cleanName(name));if(!jpeg(parsed.base))throw Error('Имя должно оканчиваться на .jpg или .jpeg');let candidate=path.join(folder,parsed.base),n=2;while(await exists(path.join(c.root,candidate)))candidate=path.join(folder,parsed.name+'_'+n+++parsed.ext);return candidate;}
  async rename(id,name){const {c,f}=this.find(id);name=cleanName(name);if(!jpeg(name))name+='.jpg';if(name===f.name)return structuredClone(f);const target=await this.freeName(c,path.dirname(f.path),name),old=await this.disk(c,f.path);await fs.link(old,path.join(c.root,target));try{await fs.unlink(old);}catch(e){await fs.unlink(path.join(c.root,target));throw e;}f.path=target;f.name=path.basename(target);await this.persist(c);return structuredClone(f);}
  async renameRoll(id,options){
    const r=this.archive().rolls.find(r=>r.id===id);if(!r)throw Error('Папка недоступна');
    const {numberedFilename}=await import('../src/metadata.js');
    const c=[...this.catalogs.values()].find(c=>c.id===r.sourceId),stored=c.rolls.find(x=>x.id===id);
    const stem=options?.stem||cleanName([r.number,r.film?.replace(/\s+/g,'')].filter(Boolean).join('_'))||'photo';
    let next=Math.max(0,...stored.frames.map(f=>f.sequence||0));
    for(const f of stored.frames){
      if(f.sequence)continue;
      const parent=stored.frames.find(x=>x.id===f.derivedFrom);
      if(parent){parent.sequence??=++next;f.sequence=parent.sequence;f.part=/[_-]r\.jpe?g$/i.test(f.name)?'r':'l';}
      else f.sequence=++next;
    }
    for(const f of stored.frames.filter(f=>!f.deleted&&!f.missing)){
      if(!options&&f.importRenamed)continue;
      const original=f.name;await this.rename(f.id,numberedFilename(stem,f.sequence,f.part));
      f.originalName??=original;f.importRenamed=true;
    }
    await this.persist(c);
    if(options?.renameFolder)await this.renameFolder(c,stored);
    return this.archive();
  }
  async renameFolder(c,r){
    const {folderName}=await import('../src/metadata.js');
    const name=cleanName(folderName(r));
    if(!name)return;
    const old=r.folder?path.join(c.root,r.folder):c.root,target=path.join(path.dirname(old),name);
    if(old===target)return;
    if(await exists(target))throw Error('Папка с таким названием уже существует. Измените название.');
    await fs.rename(old,target);const canonicalTarget=await fs.realpath(target);
    if(!r.folder){this.catalogs.delete(c.root);c.root=canonicalTarget;this.catalogs.set(canonicalTarget,c);}
    else {const oldFolder=r.folder,prefix=oldFolder+path.sep,folder=path.relative(c.root,canonicalTarget);
      for(const roll of c.rolls){if(roll.folder!==oldFolder&&!roll.folder.startsWith(prefix))continue;
        for(const f of roll.frames)f.path=path.join(folder,path.relative(oldFolder,f.path));
        roll.folder=path.join(folder,path.relative(oldFolder,roll.folder));}
    }
    await this.persist(c);this.settings.roots=[...this.catalogs.keys()];await this.settingsSave();
  }
  async split(id,edits){const {c,r,f}=this.find(id);if(r.frames.some(x=>x.derivedFrom===id&&!x.deleted))throw Error('У этого скана уже есть половины');const rendered=await this.render(id,edits),{width,height}=await sharp(rendered).metadata();if(width<2)throw Error('Скан слишком узкий');const children=[],created=[];try{for(let i=0;i<2;i++){const left=i?Math.floor(width/2):0,w=i?width-left:Math.floor(width/2),name=f.name.replace(/\.jpe?g$/i,'')+(i?'-r':'-l')+'.jpg';const relative=await this.freeName(c,path.dirname(f.path),name);const output=await sharp(rendered).extract({left,top:0,width:w,height}).withMetadata({orientation:1}).jpeg({quality:98,chromaSubsampling:'4:4:4'}).toBuffer();await fs.writeFile(path.join(c.root,relative),output,{flag:'wx'});created.push(relative);const stat=await fs.stat(path.join(c.root,relative));children.push({id:randomUUID(),path:relative,name:path.basename(relative),derivedFrom:id,sequence:f.sequence,part:i?'r':'l',viewed:false,rating:0,favorite:false,edits:{},savedEdits:{},size:stat.size,modified:stat.mtimeMs,importRenamed:true});}
    r.frames.splice(r.frames.indexOf(f)+1,0,...children);await this.persist(c);
    }catch(e){r.frames=r.frames.filter(x=>!children.includes(x));for(const relative of created)await fs.rm(path.join(c.root,relative),{force:true});throw e;}return children.map(x=>({...x,desktop:true}));}
  async remove(id){const {c,f}=this.find(id);await this.trash(await this.disk(c,f.path));f.deleted=true;await this.persist(c);}
}
module.exports={Library,atomic,cleanName};
