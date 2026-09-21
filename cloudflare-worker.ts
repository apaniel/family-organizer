// Generated Next handler; no legacy InstantDB calendar cron remains.
// @ts-ignore
import handler from './.open-next/worker.js';
// @ts-ignore
export {DOQueueHandler,DOShardedTagCache,BucketCachePurge} from './.open-next/worker.js';
import {socketIdentity} from './lib/chat-socket';
export {ChatNotifications} from './lib/chat-socket';
export default {async fetch(request: Request, env: any, ctx: any) {
 if (new URL(request.url).pathname !== '/api/family/chat/socket') return handler.fetch(request,env,ctx);
 if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required',{status:426});
 const identity = await socketIdentity(request,env);
 if (!identity) return new Response('Unauthorized',{status:401});
 const headers = new Headers({Upgrade:'websocket','x-chat-tag':identity.tag,'x-chat-expires':String(identity.expires)});
 return env.CHAT_NOTIFICATIONS.get(env.CHAT_NOTIFICATIONS.idFromName('chat')).fetch(new Request('https://chat/socket',{headers}));
}};
