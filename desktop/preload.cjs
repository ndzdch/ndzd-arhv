const {contextBridge,ipcRenderer,webUtils}=require('electron');
const call=(name,...args)=>ipcRenderer.invoke('desktop:'+name,...args);
contextBridge.exposeInMainWorld('desktop',{
 commitUpload:(token,data,stem)=>call('commitUpload',token,data,stem),cancelUpload:token=>call('cancelUpload',token),pathForFile:file=>webUtils.getPathForFile(file),pickUpload:()=>call('pickUpload'),openPaths:paths=>call('openPaths',paths),read:key=>call('read',key),write:(key,value)=>call('write',key,value),
 disconnect:id=>call('disconnect',id),openFolder:()=>call('openFolder'),refresh:()=>call('refresh'),bytes:id=>call('bytes',id),thumbnail:id=>call('thumbnail',id),
 rename:(id,name)=>call('rename',id,name),renameRoll:(id,options)=>call('renameRoll',id,options),
 saveImage:(id,edits)=>call('saveImage',id,edits),split:(id,edits)=>call('split',id,edits),
 remove:id=>call('remove',id),showFolder:id=>call('showFolder',id),showTrash:()=>call('showTrash'),
 onMenu:callback=>ipcRenderer.on('desktop:menu',(_event,action)=>callback(action))
});
