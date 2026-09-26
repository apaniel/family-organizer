import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {GET,POST,PATCH,DELETE} from '@/app/api/family/gifts/route';
import {verifiedFamilyEmail,isVerifiedFamilyParent} from '@/lib/cloudflare-family-access';
import {listGifts,createGift,updateGift,deleteGift} from '@/lib/family-mission/gift-store';
vi.mock('@/lib/cloudflare-family-access',()=>({verifiedFamilyEmail:vi.fn(),isVerifiedFamilyParent:vi.fn()}));
vi.mock('@/lib/family-mission/gift-store',()=>({listGifts:vi.fn(),createGift:vi.fn(),updateGift:vi.fn(),deleteGift:vi.fn()}));
const req=(method:string,body?:unknown,headers={})=>new NextRequest('https://apalas.test/api/family/gifts',{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
const fields={title:' Libro ',child:'Alejandra',occasion:'christmas',status:'idea',notes:' ilustrado '};
beforeEach(()=>{process.env.CALENDAR_SYNC_CRON_SECRET='test-service';vi.mocked(verifiedFamilyEmail).mockResolvedValue(null);vi.mocked(isVerifiedFamilyParent).mockResolvedValue(false);vi.mocked(listGifts).mockResolvedValue([]);});
it('requires verified parent or service auth for every method and ignores browser identity headers',async()=>{
 for(const [method,handler] of Object.entries({GET,POST,PATCH,DELETE}))expect((await handler(req(method,method==='GET'?undefined:fields,{'cf-access-authenticated-user-email':'crislacorte@hotmail.com','x-calendar-sync-secret':'wrong'}))).status).toBe(401);
 expect(createGift).not.toHaveBeenCalled();expect(listGifts).not.toHaveBeenCalled();
});
it.each(['GET','POST','PATCH','DELETE'])('accepts the existing trusted service credential for %s',async method=>{
 const handlers={GET,POST,PATCH,DELETE};
 const r=await handlers[method as keyof typeof handlers](req(method,method==='GET'?undefined:{...fields,id:'one',revision:1},{'x-calendar-sync-secret':'test-service'}));
 expect(r.status).toBe(method==='POST'?201:200);
 if(method==='POST')expect(createGift).toHaveBeenCalledWith(expect.objectContaining({createdBy:'Rufus'}));
});
it.each([['crislacorte@hotmail.com','Cris'],['lacorte.cristina@gmail.com','Cris'],['apavicio@gmail.com','Dani'],['dapamar90@gmail.com','Dani']])('derives %s identity server-side',async(email,person)=>{
 vi.mocked(verifiedFamilyEmail).mockResolvedValue(email);
 expect((await POST(req('POST',{...fields,createdBy:'Forged',createdAt:'fake',revision:99},{'cf-access-jwt-assertion':'signed'}))).status).toBe(201);
 expect(verifiedFamilyEmail).toHaveBeenCalledWith('signed');
 expect(createGift).toHaveBeenCalledWith({...fields,title:'Libro',notes:'ilustrado',createdBy:person});
});
it('lists privately with no cache',async()=>{
 vi.mocked(verifiedFamilyEmail).mockResolvedValue('apavicio@gmail.com');
 const r=await GET(req('GET'));expect(r.headers.get('cache-control')).toBe('private, no-store');expect(await r.json()).toEqual({items:[]});
});
it.each([null,[],{}, {...fields,title:' '},{...fields,title:'x'.repeat(201)},{...fields,notes:44},{...fields,notes:'x'.repeat(2001)},{...fields,child:'Other'},{...fields,occasion:'easter'},{...fields,status:'done'}])('validates create payload %j',async body=>{
 vi.mocked(verifiedFamilyEmail).mockResolvedValue('apavicio@gmail.com');expect((await POST(req('POST',body))).status).toBe(400);expect(createGift).not.toHaveBeenCalled();
});
it('defaults new ideas to unassigned and idea',async()=>{
 vi.mocked(verifiedFamilyEmail).mockResolvedValue('apavicio@gmail.com');await POST(req('POST',{title:'Libro',child:'Paula'}));expect(createGift).toHaveBeenCalledWith({title:'Libro',child:'Paula',occasion:'unassigned',status:'idea',createdBy:'Dani'});
});
it.each([{id:'one',revision:0,title:'x'},{id:'one',revision:1.5,title:'x'},{id:'one',title:'x'},{id:'',revision:1,title:'x'},{id:'one',revision:1},{id:'one',revision:1,child:'other'},{id:'one',revision:1,status:'done'}])('validates updates %j',async body=>{
 vi.mocked(verifiedFamilyEmail).mockResolvedValue('apavicio@gmail.com');expect((await PATCH(req('PATCH',body))).status).toBe(400);expect(updateGift).not.toHaveBeenCalled();
});
it('only passes mutable fields and expected revision to the store',async()=>{
 vi.mocked(verifiedFamilyEmail).mockResolvedValue('apavicio@gmail.com');
 await PATCH(req('PATCH',{id:'one',revision:2,...fields,createdBy:'Forged',createdAt:'fake'}));
 expect(updateGift).toHaveBeenCalledWith('one',2,{...fields,title:'Libro',notes:'ilustrado'});
 expect((await DELETE(req('DELETE',{id:'one'}))).status).toBe(400);
 await DELETE(req('DELETE',{id:'one',revision:2}));expect(deleteGift).toHaveBeenCalledWith('one',2);
});
it.each([['CONFLICT',409],['NOT_FOUND',404],['database secret failure',503]])('maps store failure %s safely',async(message,status)=>{
 vi.mocked(verifiedFamilyEmail).mockResolvedValue('apavicio@gmail.com');
 for(const [handler,mock,method] of [[PATCH,updateGift,'PATCH'],[DELETE,deleteGift,'DELETE']] as const){vi.mocked(mock).mockRejectedValue(new Error(message));const r=await handler(req(method,{id:'one',revision:1,status:'bought'}));expect(r.status).toBe(status);expect(JSON.stringify(await r.json())).not.toContain(message);}
});
it('handles malformed JSON without writing',async()=>{
 vi.mocked(verifiedFamilyEmail).mockResolvedValue('apavicio@gmail.com');expect((await POST(new NextRequest('https://apalas.test/api/family/gifts',{method:'POST',body:'{'}))).status).toBe(400);expect(createGift).not.toHaveBeenCalled();
});
