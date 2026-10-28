import {activeFrames,hasEdits} from './editor-model.js';
export const compareNames = (a, b) => a.localeCompare(b, 'ru', { numeric:true, sensitivity:'base' });
export const isJPEG = name => /\.jpe?g$/i.test(name);
export function plural(n, forms) {
  const k = Math.abs(n) % 100;
  return `${n} ${forms[k > 10 && k < 20 ? 2 : k % 10 === 1 ? 0 : k % 10 > 1 && k % 10 < 5 ? 1 : 2]}`;
}
export function groupFiles(entries, source, previous = []) {
  const groups = new Map();
  const old = new Map(previous.map(r => [r.id, r]));
  for (const entry of entries) {
    if (!isJPEG(entry.name)) continue;
    const path = entry.path.replaceAll('\\', '/');
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const id = `${source.id}/${folder}`;
    if (!groups.has(id)) {
      const existing = old.get(id);
      groups.set(id, { id, sourceId:source.id, folder, title:existing?.title || folder.split('/').pop() || source.name,
        number:existing?.number || (folder.match(/(?:^|\/)(\d+)/)?.[1] ?? ''),
        film:existing?.film || '', iso:existing?.iso || '', camera:existing?.camera || '', dateStart:existing?.dateStart||'', dateEnd:existing?.dateEnd||'', date:existing?.date || '', description:existing?.description || '', completed:existing?.completed===true, workStarted:existing?.workStarted===true, filenameYear:existing?.filenameYear||'', fileName:existing?.fileName||'', includeNdzd:existing?.includeNdzd!==false, frames:[] });
    }
    const roll = groups.get(id);
    const frameId = `${source.id}/${path}`;
    const saved = old.get(id)?.frames.find(f => f.id === frameId);
    roll.frames.push({ ...saved, id:frameId, name:entry.name, path, viewed:saved?.viewed || false, rating:saved?.rating || 0,
      rejected:saved?.rejected || false, size:entry.size, modified:entry.modified });
  }
  return [...groups.values()].sort((a,b)=>compareNames(a.folder,b.folder)).map(r=>({ ...r, frames:r.frames.sort((a,b)=>compareNames(a.name,b.name)) }));
}
export function filterRolls(rolls, { query='', film='', period='', incomplete=false } = {}) {
  const normalize=value=>String(value??'').toLocaleLowerCase('ru').replaceAll('ё','е');
  const words=normalize(query).trim().split(/\s+/).filter(Boolean);
  return rolls.filter(r => words.every(word=>[r.title,r.number,r.description,r.folder,r.film,r.iso,r.camera,r.date,r.dateStart,r.dateEnd].map(normalize).join(' ').includes(word)) &&
    (!film || r.film === film) && (!period || [r.date,r.dateStart,r.dateEnd].filter(Boolean).join(' ').includes(period)) && (!incomplete || r.completed!==true));
}
export function filterFrames(frames, { query='', unseen=false, rating='', favorites=false } = {}) {
  return frames.filter(f => (!favorites||f.favorite)&&!f.deleted&&!f.splitHidden&&(!query || f.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))) && (!unseen || !f.viewed) && (!rating || f.rating === Number(rating)));
}
export function selectFrame(selected, id, visibleIds, anchor, range=false) {
  const next = new Set(selected);
  if (range && visibleIds.includes(anchor) && visibleIds.includes(id)) {
    const a=visibleIds.indexOf(anchor), b=visibleIds.indexOf(id);
    visibleIds.slice(Math.min(a,b), Math.max(a,b)+1).forEach(id=>next.add(id));
  } else if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
export function pruneSelection(selected, rolls) {
  const ids = new Set(rolls.flatMap(r=>activeFrames(r).map(f=>f.id)));
  return new Set([...selected].filter(id=>ids.has(id)));
}
export function appendPhotos(roll, entries, makeId) {
  const known=new Set(roll.frames.map(f=>`${f.name}|${f.size}|${f.modified}`));
  const additions=[];
  for(const entry of entries){
    if(!isJPEG(entry.name))continue;
    const signature=`${entry.name}|${entry.size}|${entry.modified}`;
    if(known.has(signature))continue;
    known.add(signature);
    additions.push({...entry,id:roll.id+'/upload/'+makeId(),viewed:false,rating:0,rejected:false,persisted:true});
  }
  return additions;
}

export function rollStatus(r){return r.completed===true?['done','Готово']:(r.workStarted||(r.frames||[]).some(f=>f.favorite||f.deleted||f.derivedFrom||f.sourceFrameId||hasEdits(f)))?['working','В работе']:['new','Не разобрана'];}
