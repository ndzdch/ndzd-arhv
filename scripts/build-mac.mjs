import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const release=path.join(root,'release'),stage=await fs.mkdtemp(path.join(os.tmpdir(),'ndzd-build-')),app=path.join(stage,'ндзд архв.app');
await fs.mkdir(release,{recursive:true});await fs.rm(app,{recursive:true,force:true});
const electron=path.dirname(require.resolve('electron/package.json'));
const baseApp=process.env.NDZD_BUILD_BASE_APP;
if(baseApp){const bundled=JSON.parse(await fs.readFile(path.join(baseApp,'Contents/Resources/app/node_modules/sharp/package.json'),'utf8'));if(bundled.version!==JSON.parse(await fs.readFile(path.join(root,'node_modules/sharp/package.json'),'utf8')).version)throw Error('Версия библиотеки основы отличается');}
execFileSync('/usr/bin/ditto',[baseApp||path.join(electron,'dist/Electron.app'),app]);
const contents=path.join(app,'Contents'),resources=path.join(contents,'Resources'),dest=path.join(resources,'app');
await fs.mkdir(dest,{recursive:true});
for(const name of ['desktop','src','prototype-assets','index.html'])execFileSync('/usr/bin/ditto',['--norsrc',path.join(root,name),path.join(dest,name)]);
await fs.rm(path.join(dest,'desktop/smoke.cjs'),{force:true});
await fs.copyFile(path.join(root,'desktop/app.icns'),path.join(resources,'electron.icns'));
await fs.writeFile(path.join(dest,'package.json'),JSON.stringify({name:'ndzd-arhv',productName:'ндзд архв',version,main:'desktop/main.cjs'}));
const copied=new Set();
async function copyDependency(name,parent){
 const resolver=createRequire(path.join(parent,'package.json'));let file;
 try{try{file=resolver.resolve(name+'/package');}catch{file=resolver.resolve(name+'/package.json');}}catch{try{let dir=path.dirname(resolver.resolve(name));while(true){try{const data=JSON.parse(await fs.readFile(path.join(dir,'package.json')));if(data.name===name){file=path.join(dir,'package.json');break;}}catch{}const next=path.dirname(dir);if(dir===next)return;dir=next;}}catch{return;}}
 if(copied.has(name))return;copied.add(name);const folder=path.dirname(file),pkg=JSON.parse(await fs.readFile(file));
 execFileSync('/usr/bin/ditto',['--norsrc',folder,path.join(dest,'node_modules',name)]);
 for(const dep of new Set([...Object.keys(pkg.dependencies||{}),...Object.keys(pkg.optionalDependencies||{})]))await copyDependency(dep,folder);
}
if(!baseApp)await copyDependency('sharp',root);
if(!baseApp)await fs.rename(path.join(contents,'MacOS/Electron'),path.join(contents,'MacOS/ndzd-arhv'));
const plist=path.join(contents,'Info.plist');
for(const [key,value] of Object.entries({CFBundleExecutable:'ndzd-arhv',CFBundleName:'ндзд архв',CFBundleDisplayName:'ндзд архв',CFBundleIdentifier:'local.ndzd.arhv',CFBundleShortVersionString:version,CFBundleVersion:version,NSHumanReadableCopyright:'ндзд архв'}))execFileSync('/usr/bin/plutil',['-replace',key,'-string',value,plist]);
for(const attribute of ['com.apple.FinderInfo','com.apple.ResourceFork']){try{execFileSync('/usr/bin/xattr',['-dr',attribute,app],{stdio:'ignore'});}catch{}}
// Local ad-hoc signature, no publication or developer account needed.
execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
await fs.symlink('/Applications',path.join(stage,'Программы'));
await fs.writeFile(path.join(stage,'Как установить.txt'),'Перетащите «ндзд архв» в «Программы». Затем откройте приложение и выберите папку с JPEG.\nСохранить изменения фотографии: ⌘S. Удаление отправляет файл в корзину Mac.\nСкрытая папка .ndzd хранит каталог и оригиналы для сброса правок.\n');
const dmg=path.join(release,`ndzd-arhv-${version}-arm64.dmg`);
execFileSync('/usr/bin/hdiutil',['create','-volname','ндзд архв','-srcfolder',stage,'-format','UDZO','-ov',dmg],{stdio:'inherit'});
console.log(dmg);await fs.rm(stage,{recursive:true,force:true});
