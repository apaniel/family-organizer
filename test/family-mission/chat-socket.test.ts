import {describe,it,expect,vi} from 'vitest';
import {ChatNotifications,socketIdentity} from '../../lib/chat-socket';
vi.mock('../../lib/cloudflare-family-access',()=>({verifiedFamilyEmail:vi.fn(async(token)=>token ? 'apavicio@gmail.com' : null)}));
const env={CALENDAR_SYNC_CRON_SECRET:'private'};
const req=(query:string,headers:Record<string,string>={})=>new Request('https://apalas.apaniel.dev/api/family/chat/socket?'+query,{headers});
describe('chat sockets',()=>{
 it('requires service credentials for the consumer and external app identities',async()=>{
  expect(await socketIdentity(req('worker=1'),env)).toBeNull();
  expect(await socketIdentity(req('external=finenance&person=Dani&conversation=finenance-abc'),env)).toBeNull();
  expect(await socketIdentity(req('worker=1',{'x-calendar-sync-secret':'private'}),env)).toMatchObject({tag:'worker'});
 });
 it('rejects external namespace confusion and forged identities',async()=>{
  const headers={'x-calendar-sync-secret':'private'};
  expect(await socketIdentity(req('external=finenance&person=Dani&conversation=allianz-abc',headers),env)).toBeNull();
  expect(await socketIdentity(req('external=finenance&person=Unknown&conversation=finenance-abc',headers),env)).toBeNull();
  expect(await socketIdentity(req('external=finenance&person=Cris&conversation=finenance-abc',headers),env)).toMatchObject({tag:'Cris:finenance-abc'});
 });
 it('rejects cross-origin browser sockets and derives identity from JWT',async()=>{
  const claims=Buffer.from(JSON.stringify({exp:Date.now()/1000+60})).toString('base64url');
  const headers={'cf-access-jwt-assertion':'header.'+claims+'.signature',origin:'https://evil.example'};
  expect(await socketIdentity(req('conversation=thread-1',headers),env)).toBeNull();
  headers.origin='https://apalas.apaniel.dev';
  const identity=await socketIdentity(req('conversation=thread-1&person=Cris',headers),env);
  expect(identity?.tag).toBe('Dani:thread-1');
  expect(identity!.expires).toBeLessThan(Date.now()+61000);
 });
 it('notifies only the matching conversation, waking consumer only for submissions',async()=>{
  const socket=(tag:string,expires=Date.now()+10000)=>({deserializeAttachment:()=>({tag,expires}),send:vi.fn(),close:vi.fn()});
  const dani=socket('Dani:thread-1'),cris=socket('Cris:thread-1'),other=socket('Dani:thread-2'),worker=socket('worker'),expired=socket('Dani:thread-1',1);
  const hub=new ChatNotifications({getWebSockets:()=>[dani,cris,other,worker,expired]});
  await hub.fetch(new Request('https://chat/notify',{method:'POST',body:JSON.stringify({tag:'Dani:thread-1',wake:false})}));
  expect(dani.send).toHaveBeenCalledWith('changed');expect(cris.send).not.toHaveBeenCalled();expect(other.send).not.toHaveBeenCalled();expect(worker.send).not.toHaveBeenCalled();expect(expired.send).not.toHaveBeenCalled();expect(expired.close).toHaveBeenCalled();
  await hub.fetch(new Request('https://chat/notify',{method:'POST',body:JSON.stringify({tag:'Dani:thread-1',wake:true})}));
  expect(worker.send).toHaveBeenCalledWith('changed');
 });
});
