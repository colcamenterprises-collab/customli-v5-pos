// Keep photographs out of localStorage's small quota. Keys include tenant,
// location, staff and shift through the caller's scope.
let opening;
const database=()=>opening||=new Promise((resolve,reject)=>{const request=indexedDB.open('customli-closing-evidence-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('photos');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
const operate=async(scope,id,mode,action)=>{const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('photos',mode),request=action(tx.objectStore('photos'),scope+':'+id);let result;request.onsuccess=()=>result=request.result;request.onerror=()=>reject(request.error);tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||Error('Photo storage was interrupted'))})};
export const savePhoto=(scope,id,photo)=>operate(scope,id,'readwrite',(store,key)=>store.put(photo,key));
export const loadPhoto=(scope,id)=>operate(scope,id,'readonly',(store,key)=>store.get(key));
export const removePhoto=(scope,id)=>operate(scope,id,'readwrite',(store,key)=>store.delete(key));
