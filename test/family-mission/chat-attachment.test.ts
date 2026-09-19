import {it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
vi.mock('../../lib/calendar-sync-auth',()=>({requireCalendarSyncRouteAuth:vi.fn(async()=>({authorized:true,kind:'service'}))}));
vi.mock('../../lib/family-mission/chat-store',()=>({chatAttachment:vi.fn(async()=>({name:'foto.jpg',type:'image/jpeg',body:new Uint8Array([1,2,3])}))}));
import {GET} from '../../app/api/family/chat/attachments/[id]/route';
it('serves private chat attachments only to the family service',async()=>{const r=await GET(new NextRequest('https://apalas.apaniel.dev/api/family/chat/attachments/a'),{params:Promise.resolve({id:'a'})});expect(r.status).toBe(200);expect(r.headers.get('content-type')).toBe('image/jpeg');expect(r.headers.get('content-disposition')).toContain('foto.jpg');});
