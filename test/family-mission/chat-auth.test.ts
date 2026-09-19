import {describe,it,expect,vi,beforeAll} from 'vitest';
import {verifiedFamilyEmail,isVerifiedFamilyParent} from '../../lib/cloudflare-family-access';
let key:CryptoKey;let jwk:JsonWebKey;
const enc=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64url');
async function token(email:string,extra:Record<string,unknown>={}){const data=enc({alg:'RS256',kid:'chat-test'})+'.'+enc({iss:'https://apalabs.cloudflareaccess.com',aud:['2f8201ee1f9854a7746e6f39e4f02330805a69327108dec11a98decebfe61bf1'],exp:Date.now()/1000+300,email,...extra});const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(data));return data+'.'+Buffer.from(sig).toString('base64url');}
beforeAll(async()=>{const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);key=pair.privateKey;jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);});
describe('Dashboard chat identity',()=>{
 it('verifies each approved parent email',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({keys:[{...jwk,kid:'chat-test'}]})));for(const email of ['apavicio@gmail.com','dapamar90@gmail.com','crislacorte@hotmail.com','lacorte.cristina@gmail.com'])expect(await verifiedFamilyEmail(await token(email))).toBe(email);});
 it('rejects missing token, unknown email and wrong audience',async()=>{expect(await verifiedFamilyEmail(null)).toBeNull();expect(await verifiedFamilyEmail(await token('other@gmail.com'))).toBeNull();expect(await verifiedFamilyEmail(await token('apavicio@gmail.com',{aud:['other']}))).toBeNull();});
 it('rejects expired and tampered signatures',async()=>{expect(await isVerifiedFamilyParent(await token('apavicio@gmail.com',{exp:1}))).toBe(false);const t=await token('apavicio@gmail.com');const [h,p,s]=t.split('.');expect(await verifiedFamilyEmail(h+'.'+p+'.'+(s[0]==='A'?'B':'A')+s.slice(1))).toBeNull();});
});
