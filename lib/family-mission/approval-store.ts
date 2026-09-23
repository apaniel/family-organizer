import 'server-only';
import {getCloudflareContext} from '@opennextjs/cloudflare';

export type ApprovalChoice='once'|'session'|'always'|'deny';
export type DashboardApproval={id:string;digest:string;command:string;description:string;allowedChoices:ApprovalChoice[];status:'pending'|'decided'|'consumed'|'expired';choice?:ApprovalChoice;decidedBy?:string;createdAt:string;expiresAt:string};
async function notifyApprovals(){
 try {
  const {env}=await getCloudflareContext({async:true});
  const hub=(env as any).CHAT_NOTIFICATIONS;
  if(hub)await hub.get(hub.idFromName('chat')).fetch('https://chat/notify',{method:'POST',body:JSON.stringify({tag:'approvals',wake:false})});
 } catch { /* The durable change succeeded; the recovery poll reconciles missed events. */ }
}
async function database():Promise<any>{const {env}=await getCloudflareContext({async:true});const db=(env as any).FAMILY_DB;if(!db)throw new Error('Family storage unavailable');return db;}
const sourceKey=(id:string)=>'approval:'+id;
const unpack=(row:any):DashboardApproval=>JSON.parse(row.data).approval;
export async function createApproval(value:DashboardApproval){const db=await database(),now=new Date().toISOString();const data=JSON.stringify({kind:'task',title:'Aprobación de Rufus',date:now.slice(0,10),owner:'Dani',status:'waiting',category:'home',notes:'',checklist:[],audience:'adults',slot:'dinner',recurrence:'none',source:'Rufus',sourceKey:sourceKey(value.id),confirmed:true,reminderDays:0,approval:value});await db.prepare('INSERT INTO family_records(id,kind,data,source_key,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(source_key) DO UPDATE SET data=excluded.data,revision=family_records.revision+1,updated_at=excluded.updated_at').bind(crypto.randomUUID(),'task',data,sourceKey(value.id),now,now).run();await notifyApprovals();return value;}
export async function listPendingApprovals(){
 const db=await database(),now=new Date().toISOString();
 const result=await db.prepare(`SELECT data FROM family_records
  WHERE source_key >= 'approval:' AND source_key < 'approval;'
   AND json_extract(data,'$.approval.status') = 'pending'
   AND json_extract(data,'$.approval.expiresAt') > ?
  ORDER BY created_at DESC LIMIT 20`).bind(now).all();
 return (result.results||[]).map(unpack);
}
export async function decideApproval(id:string,choice:ApprovalChoice,person:string){const db=await database(),row=await db.prepare('SELECT * FROM family_records WHERE source_key=?').bind(sourceKey(id)).first();if(!row)throw new Error('NOT_FOUND');const data=JSON.parse(row.data),approval:DashboardApproval=data.approval;if(approval.status!=='pending'||approval.expiresAt<=new Date().toISOString())throw new Error('EXPIRED');if(!approval.allowedChoices.includes(choice))throw new Error('INVALID');data.approval={...approval,status:'decided',choice,decidedBy:person};const result=await db.prepare('UPDATE family_records SET data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(data),new Date().toISOString(),row.id,row.revision).run();if(!result.meta?.changes)throw new Error('CONFLICT');await notifyApprovals();return data.approval as DashboardApproval;}
export async function approvalState(id:string){const db=await database(),row=await db.prepare('SELECT data FROM family_records WHERE source_key=?').bind(sourceKey(id)).first();return row?unpack(row):null;}
export async function consumeApproval(id:string){const db=await database(),row=await db.prepare('SELECT * FROM family_records WHERE source_key=?').bind(sourceKey(id)).first();if(!row)return;const data=JSON.parse(row.data);data.approval={...data.approval,status:'consumed'};await db.prepare('UPDATE family_records SET data=?,revision=revision+1,updated_at=? WHERE id=?').bind(JSON.stringify(data),new Date().toISOString(),row.id).run();await notifyApprovals();}
