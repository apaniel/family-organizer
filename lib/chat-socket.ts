import {verifiedFamilyEmail} from './cloudflare-family-access';

// The socket carries invalidations only. Message content stays behind the existing API auth.
export async function socketIdentity(request: Request, env: any) {
 const url = new URL(request.url);
 const service = !!env.CALENDAR_SYNC_CRON_SECRET && request.headers.get('x-calendar-sync-secret') === env.CALENDAR_SYNC_CRON_SECRET;
 if (url.searchParams.get('worker') === '1') return service ? {tag:'worker', expires:Date.now()+3600000} : null;
 const source = url.searchParams.get('external');
 let person: string | null;
 let expires = Date.now()+3600000;
 if (source) {
  if (!service || !['finenance','allianz'].includes(source)) return null;
  person = url.searchParams.get('person');
  if (!['Dani','Cris'].includes(person)) return null;
 } else {
  if (request.headers.get('origin') !== url.origin) return null;
  const email = await verifiedFamilyEmail(request.headers.get('cf-access-jwt-assertion'));
  if (!email) return null;
  const token = request.headers.get('cf-access-jwt-assertion')!;
  const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  expires = Math.min(expires, claims.exp*1000);
  person = ['apavicio@gmail.com','dapamar90@gmail.com'].includes(email) ? 'Dani' : 'Cris';
 }
 // Approval invalidations are shared only with authenticated family browsers.
 if (url.searchParams.get('scope') === 'approvals') return source ? null : {tag:'approvals', expires};
 const conversation = url.searchParams.get('conversation') || '';
 if (!/^[a-zA-Z0-9-]{2,80}$/.test(conversation) || (source && !conversation.startsWith(source+'-'))) return null;
 return {tag:person+':'+conversation, expires};
}

export class ChatNotifications {
 constructor(private ctx: any) {}
 async fetch(request: Request) {
  const url = new URL(request.url);
  if (url.pathname === '/notify' && request.method === 'POST') {
   const {tag, wake} = await request.json() as {tag:string;wake:boolean};
   for (const socket of this.ctx.getWebSockets()) {
    const attachment = socket.deserializeAttachment();
    if (attachment.expires <= Date.now()) { socket.close(1000,'Reconnect'); continue; }
    if (attachment.tag === tag || (wake && attachment.tag === 'worker')) {
     try { socket.send('changed'); } catch { socket.close(1011,'Reconnect'); }
    }
   }
   return new Response(null,{status:204});
  }
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required',{status:426});
  // Only the authenticated outer Worker can call this private binding.
  const pair = new (globalThis as any).WebSocketPair();
  pair[1].serializeAttachment({tag:request.headers.get('x-chat-tag'),expires:Number(request.headers.get('x-chat-expires'))});
  this.ctx.acceptWebSocket(pair[1]);
  return new Response(null,{status:101,webSocket:pair[0]} as any);
 }
 webSocketMessage(socket: any) { socket.close(1008,'Receive-only socket'); }
 webSocketClose(socket: any, code: number) { socket.close(code); }
 webSocketError(socket: any) { socket.close(1011,'Reconnect'); }
}
