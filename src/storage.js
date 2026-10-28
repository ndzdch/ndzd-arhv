const dbPromise = window.desktop ? null : new Promise((resolve, reject) => {
  const request=indexedDB.open('plenka-archive',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('settings');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
});
export async function read(key) {
  if(window.desktop)return window.desktop.read(key);
  const db=await dbPromise;
  return new Promise((resolve,reject)=>{const request=db.transaction('settings').objectStore('settings').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
export async function write(key,value) {
  if(window.desktop)return window.desktop.write(key,value);
  const db=await dbPromise;
  return new Promise((resolve,reject)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
export async function writeBatch(entries) {
  if(window.desktop){for(const [key,value] of entries)await write(key,value);return;}
  const db=await dbPromise;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('settings','readwrite');
    for(const [key,value] of entries)tx.objectStore('settings').put(value,key);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
// Explicit user-requested, one-time reset of this app's data only.
export async function resetOnce(version) {
  if(await read('reset-version')===version)return false;
  const db=await dbPromise;
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings');
    store.clear();store.put(version,'reset-version');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  return true;
}

export async function removeKeys(keys) {
  if(!keys.length||window.desktop)return;
  const db=await dbPromise;
  return new Promise((resolve,reject)=>{const tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings');keys.forEach(key=>store.delete(key));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
