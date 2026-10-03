type RelayError={status:503;reason:'d1_daily_write_limit'|'d1_daily_read_limit'|'storage_unavailable';retryAfter:number}|{status:400;reason:'invalid_json';retryAfter?:never}|{status:409;reason:'rejected';retryAfter?:never};
export function classifyRelayError(error:unknown,now=Date.now()):RelayError{
 const message=error instanceof Error?error.message:typeof error==='string'?error:'';
 const daily=message.match(/exceeded D1's free tier daily row (write|read) limit/i);
 if(daily){const date=new Date(now);const midnight=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1);return {status:503,reason:daily[1].toLowerCase()==='write'?'d1_daily_write_limit':'d1_daily_read_limit',retryAfter:Math.max(1,Math.ceil((midnight-now)/1000))};}
 if(/^D1_ERROR|D1|SQLITE|storage|network connection lost|overloaded/i.test(message))return {status:503,reason:'storage_unavailable',retryAfter:30};
 if(error instanceof SyntaxError)return {status:400,reason:'invalid_json'};
 return {status:409,reason:'rejected'};
}
