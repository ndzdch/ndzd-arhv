import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const dest=path.join(root,'browser-demo');
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
await fs.mkdir(dest,{recursive:true});
async function copyTree(relative){
  const source=path.join(root,relative),target=path.join(dest,relative),stat=await fs.stat(source);
  if(stat.isDirectory()){
    await fs.mkdir(target,{recursive:true});
    for(const name of await fs.readdir(source))await copyTree(path.join(relative,name));
    return;
  }
  let from=source;
  if(execFileSync('/bin/ls',['-ldO',source],{encoding:'utf8'}).includes('dataless')){
    // Use an identical bundled resource when iCloud has evicted the local bytes.
    const bundled=path.join('/Applications/ндзд архв.app/Contents/Resources/app',relative);
    const other=await fs.stat(bundled);
    if(other.size!==stat.size||Math.abs(other.mtimeMs-stat.mtimeMs)>1000)throw Error('Нет актуального локального ресурса: '+relative);
    from=bundled;
  }
  await fs.copyFile(from,target);
}
for(const name of ['src','prototype-assets'])await copyTree(name);
async function adapt(name,changes){
  let source=await fs.readFile(path.join(root,name),'utf8');
  for(const [before,after] of changes){
    if(!source.includes(before))throw Error(`Исходник изменился: ${name}: ${before}`);
    source=source.replaceAll(before,after);
  }
  await fs.writeFile(path.join(dest,name),source);
}
await adapt('index.html',[
  ['<head>','<head>\n  <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' blob: data:; font-src \'self\'; connect-src \'none\'; form-action \'none\'; object-src \'none\'; base-uri \'none\'">'],
  ['<body>','<body class="desktop-app">'],
]);
await adapt('src/app.js',[
  ['const native=window.desktop;','const native=null;\nconst demoNotes=new Map();\nconst localStorage={getItem:key=>demoNotes.get(key),setItem:(key,value)=>demoNotes.set(key,value)};'],
  ["if(busy)return;\n  if(!('showDirectoryPicker'", "if(busy)return;\n  uploadTarget=null;photosPicker.value='';photosPicker.click();return;\n  if(!('showDirectoryPicker'"],
]);
await fs.writeFile(path.join(dest,'src/storage.js'),`// Browser demo: session memory only, no disk or server storage.
const values=new Map();
export async function read(key){return structuredClone(values.get(key));}
export async function write(key,value){values.set(key,structuredClone(value));}
export async function writeBatch(entries){for(const [key,value] of entries)await write(key,value);}
export async function resetOnce(){return false;}
export async function removeKeys(keys){keys.forEach(key=>values.delete(key));}
`);
await fs.writeFile(path.join(dest,'VERSION'),version+'\n');
console.log(`Браузерное демо ${version}: ${dest}`);
