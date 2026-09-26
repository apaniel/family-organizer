// These family_records namespaces belong to dedicated stores, never the planner.
const internalPrefixes = ['approval:', 'capability:', 'chat-conversation:', 'chat-thread:', 'gift-idea:', 'system:', 'internal:'] as const;
export function isInternalRecordKey(value:unknown):boolean {
 return typeof value==='string' && internalPrefixes.some(prefix=>value.trim().toLowerCase().startsWith(prefix));
}
export function isInternalRecord(record:any):boolean {
 return isInternalRecordKey(record?.id)||isInternalRecordKey(record?.sourceKey)||isInternalRecordKey(record?.source_key);
}
export function assertPlannerRecord(record:any):void {
 if(isInternalRecord(record))throw new Error('Este registro pertenece a un espacio reservado.');
}
export function assertPlannerRow(row:any):void {
 if(!row)return;
 assertPlannerRecord(row);
 assertPlannerRecord(JSON.parse(row.data));
}
// Filter before LIMIT so internal rows cannot crowd ordinary planner records out.
export const plannerRecordsPredicate = ['id','source_key',"json_extract(data,'$.id')","json_extract(data,'$.sourceKey')"]
 .flatMap(column=>internalPrefixes.map(prefix=>`COALESCE(TRIM(${column}), '') NOT LIKE '${prefix}%'`)).join(' AND ');
