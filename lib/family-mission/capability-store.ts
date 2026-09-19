import 'server-only';
import {getCloudflareContext} from '@opennextjs/cloudflare';

export type CapabilityStatus='idea'|'planned'|'in_progress'|'done';
export type AgentCapability={id:string;title:string;notes:string;status:CapabilityStatus;createdBy:string;createdAt:string;updatedAt:string};
const seeds=[
 ['whatsapp-inference','Inferir cosas de WhatsApp','Convertir información útil de las conversaciones autorizadas en contexto y acciones familiares, respetando permisos y privacidad.'],
 ['switchbot-api','Conectar con SwitchBot API','Controlar y consultar dispositivos SwitchBot autorizados desde Rufus.'],
 ['weather-map-dashboard','Mapa del tiempo en el Dashboard','Mostrar previsión útil para planes familiares directamente en el Dashboard.'],
 ['recurring-deal-finder','Buscador de oportunidades para compras recurrentes','Encontrar buenas oportunidades para compras habituales, por ejemplo pañales.'],
 ['purchase-history-reminders','Recordatorios de compras recurrentes basados en el historial','Anticipar compras necesarias según el historial real de compras y el ritmo de consumo.'],
 ['portable-hermes-backup','Backup portable de Hermes','Crear copias de seguridad restaurables para mover Hermes, su configuración y conocimiento a otro entorno.'],
 ['second-brain','Second brain','Construir una memoria personal y familiar consultable que organice conocimiento, decisiones y referencias útiles.'],
 ['health-sync','Health Sync','Sincronizar datos de salud autorizados para ofrecer seguimiento y contexto útil, con controles estrictos de privacidad.'],
] as const;
async function database():Promise<any>{const {env}=await getCloudflareContext({async:true});const db=(env as any).FAMILY_DB;if(!db)throw new Error('Family storage unavailable');return db;}
const key=(id:string)=>'capability:'+id;
const pack=(item:AgentCapability)=>JSON.stringify({kind:'task',title:item.title,date:item.createdAt.slice(0,10),owner:'Dani',status:'open',category:'home',notes:item.notes,checklist:[],audience:'adults',slot:'dinner',recurrence:'none',source:'Backlog de Rufus',sourceKey:key(item.id),confirmed:true,reminderDays:0,capability:item});
const unpack=(row:any):AgentCapability=>JSON.parse(row.data).capability;
async function ensureSeeds(db:any){const now=new Date().toISOString();await db.batch(seeds.map(([id,title,notes])=>{const item:AgentCapability={id,title,notes,status:'idea',createdBy:'Dani',createdAt:now,updatedAt:now};return db.prepare('INSERT OR IGNORE INTO family_records(id,kind,data,source_key,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').bind(crypto.randomUUID(),'task',pack(item),key(id),now,now);}));}
export async function listCapabilities(){const db=await database();await ensureSeeds(db);const result=await db.prepare("SELECT data FROM family_records WHERE source_key LIKE 'capability:%' ORDER BY updated_at DESC").all();const order:Record<CapabilityStatus,number>={in_progress:0,planned:1,idea:2,done:3};return (result.results||[]).map(unpack).sort((a:AgentCapability,b:AgentCapability)=>order[a.status]-order[b.status]||b.updatedAt.localeCompare(a.updatedAt));}
export async function createCapability(input:{title:string;notes?:string;createdBy:string}){const db=await database(),now=new Date().toISOString(),item:AgentCapability={id:crypto.randomUUID(),title:input.title,notes:input.notes||'',status:'idea',createdBy:input.createdBy,createdAt:now,updatedAt:now};await db.prepare('INSERT INTO family_records(id,kind,data,source_key,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').bind(crypto.randomUUID(),'task',pack(item),key(item.id),now,now).run();return item;}
export async function updateCapability(id:string,status:CapabilityStatus){const db=await database(),row=await db.prepare('SELECT * FROM family_records WHERE source_key=?').bind(key(id)).first();if(!row)throw new Error('NOT_FOUND');const item:AgentCapability={...unpack(row),status,updatedAt:new Date().toISOString()};const result=await db.prepare('UPDATE family_records SET data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(pack(item),item.updatedAt,row.id,row.revision).run();if(!result.meta?.changes)throw new Error('CONFLICT');return item;}
export async function deleteCapability(id:string){const db=await database();const result=await db.prepare('DELETE FROM family_records WHERE source_key=?').bind(key(id)).run();if(!result.meta?.changes)throw new Error('NOT_FOUND');}
