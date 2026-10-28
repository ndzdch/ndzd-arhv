import test from 'node:test';
import assert from 'node:assert/strict';
import {inferFolderMetadata,validPeriod,periodLabel} from '../src/metadata.js';
test('Folder number, film and ISO are inferred separately, preserving leading zeros',()=>{
 assert.deepEqual(inferFolderMetadata('042_Kodak Gold 200'),{title:'042_Kodak Gold 200',number:'042',film:'Kodak Gold',iso:'200'});
 assert.equal(inferFolderMetadata('Kodak Portra 400 — №017').number,'017');
 assert.equal(inferFolderMetadata('2026-05 Kodak Gold 200').number,'');
 assert.equal(inferFolderMetadata('Kodak Gold 200').number,'');
 assert.equal(inferFolderMetadata('025_Ilford_HP5_Plus_ISO400').iso,'400');
 assert.equal(inferFolderMetadata('017 CineStill 800T').film,'CineStill T');
 assert.equal(inferFolderMetadata('Без данных').film,'');
});
test('End month is optional but cannot precede start',()=>{
 assert.ok(validPeriod('2026-05',''));assert.ok(validPeriod('2026-05','2026-05'));
 assert.ok(!validPeriod('2026-06','2026-05'));assert.ok(validPeriod('','2026-05'));
 assert.match(periodLabel({dateStart:'2026-05',dateEnd:'2026-06'}),/май.*июнь/);
});

test('upload extracts only actual folder metadata and builds safe numbered filenames',async()=>{
 const {uploadFolderMetadata,filenameStem,numberedFilename}=await import('../src/metadata.js');
 const r=uploadFolderMetadata('042_Kodak Gold 200_Петербург_2024-06');
 assert.equal(r.number,'042');assert.equal(r.film,'Kodak Gold');assert.equal(r.title,'Петербург');assert.equal(r.dateStart,'2024-06');
 assert.equal(uploadFolderMetadata('042_Kodak Gold 200').title,'');
 assert.equal(uploadFolderMetadata('photos').number,'');assert.equal(uploadFolderMetadata('photos').title,'');
 assert.equal(numberedFilename(filenameStem(r),1),'ndzd-peterburg-001.jpg');
 assert.equal(numberedFilename(filenameStem({...r,includeNdzd:false}),12),'ndzd-peterburg-012.jpg');
 assert.equal(numberedFilename('custom-name-001.jpg',2),'custom-name-002.jpg');
});

test('roll numbers contain digits only and are padded to three places',async()=>{const {formatRollNumber}=await import('../src/metadata.js');assert.equal(formatRollNumber('1'),'001');assert.equal(formatRollNumber('12'),'012');assert.equal(formatRollNumber('0123'),'123');assert.equal(formatRollNumber('abc7'),'007');assert.equal(formatRollNumber('abc'),'');});


test('new films are inferred without filling title with the film name',async()=>{
 const {uploadFolderMetadata,filenameStem,numberedFilename}=await import('../src/metadata.js');
 for(const [folder,film,iso] of [['023 Kodak Vision3 500T','Kodak Vision','500'],['028 Kodak Vision3 250D','Kodak Vision','250'],['024 Agfa Aviphot 200','Agfa Aviphot','200'],['025 Ilford pan 100','Ilford Pan','100'],['026 Ilford XP2 400','Ilford XP2','400'],['027 KodakGold200','Kodak Gold','200']]){
  const r=uploadFolderMetadata(folder);assert.equal(r.film,film);assert.equal(r.iso,iso);assert.equal(r.title,'');assert(r.number);
 }
 assert.equal(numberedFilename(filenameStem({title:'Поездка',film:'Kodak Gold',includeNdzd:false}),5,'l'),'ndzd-poezdka-005-l.jpg');
 assert.equal(numberedFilename('custom-001.jpg',7,'r'),'custom-007-r.jpg');
});

test('physical folder name groups metadata with em dashes and capitalizes only its title',async()=>{const {folderName,filenameStem}=await import('../src/metadata.js');const data={number:'1',film:'Kodak Vision',iso:'200',title:'горный алтай'};assert.equal(folderName(data),'001 — Kodak Vision 200 — Горный алтай');assert.equal(data.title,'горный алтай');assert.equal(filenameStem(data),'ndzd-gornyy-altay');});

test('year-only periods overlap months within the same year',()=>{assert.equal(validPeriod('2024-06','2024'),true);assert.equal(validPeriod('2024','2024-02'),true);assert.equal(validPeriod('2025','2024'),false);assert.equal(validPeriod('2024-08','2024-07'),false);assert.equal(periodLabel({dateStart:'2024'}),'2024');});
