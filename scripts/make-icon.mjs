import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const folder=new URL('../.build-cache/icon.iconset/',import.meta.url);await fs.mkdir(folder,{recursive:true});
const svg=await fs.readFile(new URL('../prototype-assets/app-icon.svg',import.meta.url));
for(const size of [16,32,128,256,512])for(const scale of [1,2])await sharp(svg).resize(size*scale).png().toFile(fileURLToPath(new URL(`icon_${size}x${size}${scale===2?'@2x':''}.png`,folder)));
execFileSync('/usr/bin/iconutil',['-c','icns',fileURLToPath(folder),'-o',fileURLToPath(new URL('../desktop/app.icns',import.meta.url))]);
