// A write acknowledgement is not proof of paper output. In-flight jobs become
// uncertain after restart and are never replayed automatically.
export function createNativePrintQueue({storage=globalThis.localStorage,scope=()=>{try{return sessionStorage.getItem('customli-device-id')+'@'+sessionStorage.getItem('customli-location-id')}catch{return 'legacy'}},uuid=()=>crypto.randomUUID(),now=()=>new Date().toISOString()}={}){
 let busy=false,activeId=null;
 const key=()=> 'customli.v5.native-print-jobs.'+scope();
 const read=()=>{let jobs;try{jobs=JSON.parse(storage.getItem(key())||'[]')}catch{throw Error('Saved print jobs could not be read. Contact support before printing again.')}if(!Array.isArray(jobs))throw Error('Saved print jobs could not be read. Contact support before printing again.');return jobs;};
 const write=jobs=>storage.setItem(key(),JSON.stringify(jobs.slice(-200)));
 const recover=()=>{const jobs=read();let changed=false;for(const j of jobs)if(j.status==='sending'&&j.id!==activeId){j.status='uncertain';j.error='Printing was interrupted. Check the paper before choosing to print again.';j.updatedAt=now();changed=true;}if(changed)write(jobs);return jobs;};
 async function run({receiptId,receiptNumber=null,printer,purpose='receipt'},send){
  if(busy)throw Error('A print is already in progress. Wait before printing again.');
  busy=true;
  try{
   const jobs=recover(),prior=[...jobs].reverse().find(j=>j.receiptId===receiptId&&j.printerAddress===printer.address&&j.purpose===purpose);
   const job={id:uuid(),receiptId,receiptNumber,printerAddress:printer.address,purpose,parentId:prior?.id||null,reprint:!!prior,status:'sending',createdAt:now(),updatedAt:now()};
   jobs.push(job);write(jobs);activeId=job.id; // Fail closed if persistence is unavailable.
   try{await send();job.status='sent';job.error='Bytes sent. Check the printed paper.';job.updatedAt=now();write(jobs);return {jobId:job.id,sent:true,printed:false,reprint:job.reprint};}
   catch(error){job.status='uncertain';job.error='Printing was interrupted. Check the paper before choosing to print again.';job.updatedAt=now();try{write(jobs)}catch{}throw Object.assign(Error(error.message+' Check the paper before printing again.'),{jobId:job.id,printStatus:'uncertain'});}
  }finally{busy=false;activeId=null;}
 }
 return {run,jobs:recover};
}
