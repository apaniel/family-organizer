import 'server-only';
export function commandPayload(action:string,raw:any){
 if(!['save','delete'].includes(action)||!raw||typeof raw!=='object')throw new Error('Operación no válida.');
 if(raw.id!==undefined&&(typeof raw.id!=='string'||raw.id.length>300))throw new Error('ID no válido.');
 if(action==='delete'){if(!raw.id||!Number.isSafeInteger(raw.revision))throw new Error('Actualiza la tarea antes de eliminar.');return {action,record:{id:raw.id,revision:raw.revision}};}
 if(raw.kind!=='task'||raw.completeOn!==undefined||raw.checklist?.length||!['none',undefined].includes(raw.recurrence)||!['open','waiting','done'].includes(raw.status))throw new Error('Google Tasks admite tareas binarias sin repetición.');
 if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>200||typeof raw.notes!=='string'||raw.notes.length>10000||!['Dani','Cris','Saida','Familia','Sin asignar',''].includes(raw.owner))throw new Error('Revisa los datos de la tarea.');
 if(raw.date&&!/^\d{4}-\d{2}-\d{2}$/.test(raw.date))throw new Error('Fecha no válida.');
 if(raw.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time))throw new Error('Hora no válida.');
 if(raw.id&&!Number.isSafeInteger(raw.revision))throw new Error('Actualiza la tarea antes de guardar.');
 const record:any={kind:'task'};
 for(const k of ['id','revision','title','notes','owner','date','time','status','category','reminderDays','sourceKey','source'])if(raw[k]!==undefined)record[k]=raw[k];
 if(record.sourceKey!==undefined&&(typeof record.sourceKey!=='string'||record.sourceKey.length>250))throw new Error('Origen no válido.');
 if(record.owner==='')record.owner='Sin asignar';
 return {action,record};
}
