import 'server-only';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import type {GiftIdea, GiftFields} from './gift-model';

const seeds = [
 ['capibara', 'Capibara'], ['zapatos-tacones', 'Zapatos tacones'],
 ['lupa', 'Lupa'], ['plancha', 'Plancha'], ['coche-teledirigido', 'Coche teledirigido'],
] as const;
const key = (id: string) => `gift-idea:${id}`;
async function database(): Promise<any> {
 const {env} = await getCloudflareContext({async:true});
 const db = (env as any).FAMILY_DB;
 if (!db) throw new Error('Family storage unavailable');
 return db;
}
const pack = (gift: GiftIdea, deleted = false) => JSON.stringify({gift, deleted});
const unpack = (row: any): GiftIdea => ({...JSON.parse(row.data).gift, revision:row.revision});
async function ensureSeeds(db: any) {
 const now = new Date().toISOString();
 await db.batch(seeds.map(([slug,title]) => {
  const id = `seed-paula-${slug}`;
  const item: GiftIdea = {id,title,child:'Paula',occasion:'unassigned',status:'idea',createdBy:'Cris',createdAt:now,updatedAt:now,revision:1};
  return db.prepare('INSERT OR IGNORE INTO family_records(id,kind,data,source_key,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)')
   .bind(key(id),'task',pack(item),key(id),now,now);
 }));
}
export async function listGifts(): Promise<GiftIdea[]> {
 const db = await database();
 await ensureSeeds(db);
 const result = await db.prepare("SELECT * FROM family_records WHERE source_key LIKE 'gift-idea:%' AND json_extract(data,'$.deleted')=0 ORDER BY created_at, source_key").all();
 return result.results.map(unpack);
}
export async function createGift(input: GiftFields & {createdBy:string}): Promise<GiftIdea> {
 const db = await database(), now = new Date().toISOString();
 const item: GiftIdea = {...input,id:crypto.randomUUID(),createdAt:now,updatedAt:now,revision:1};
 await db.prepare('INSERT INTO family_records(id,kind,data,source_key,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)')
  .bind(key(item.id),'task',pack(item),key(item.id),now,now).run();
 return item;
}
async function changeGift(id: string, revision: number, fields: Partial<GiftFields>, deleted: boolean) {
 const db = await database();
 const row = await db.prepare('SELECT * FROM family_records WHERE source_key=?').bind(key(id)).first();
 if (!row || JSON.parse(row.data).deleted) throw new Error('NOT_FOUND');
 if (row.revision !== revision) throw new Error('CONFLICT');
 const item: GiftIdea = {...unpack(row),...fields,revision:revision+1,updatedAt:new Date().toISOString()};
 // Retain the source key on deletion so GET/deploy never recreates a removed seed.
 const result = await db.prepare('UPDATE family_records SET data=?,revision=revision+1,updated_at=? WHERE source_key=? AND revision=?')
  .bind(pack(item,deleted),item.updatedAt,key(id),revision).run();
 if (!result.meta?.changes) throw new Error('CONFLICT');
 return item;
}
export const updateGift = (id: string, revision: number, fields: Partial<GiftFields>) => changeGift(id,revision,fields,false);
export async function deleteGift(id: string, revision: number) { await changeGift(id,revision,{},true); }
