import { it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const b64 = (value:unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
it('activates only approved, signed, current identities for this application', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const pair = await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
    const jwk = {...await webcrypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key'};
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({keys:[jwk]})})));
    const {isVerifiedFamilyParent} = await import('@/lib/cloudflare-family-access');
    const claims = {iss:'https://apalabs.cloudflareaccess.com',aud:['2f8201ee1f9854a7746e6f39e4f02330805a69327108dec11a98decebfe61bf1'],exp:Date.now()/1000+60,email:'dapamar90@gmail.com'};
    async function sign(patch={}) {
        const data=b64({alg:'RS256',kid:'test-key'})+'.'+b64({...claims,...patch});
        const sig=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,Buffer.from(data));
        return data+'.'+Buffer.from(sig).toString('base64url');
    }
    expect(await isVerifiedFamilyParent(await sign())).toBe(true);
    expect(await isVerifiedFamilyParent(await sign({email:'apavicio@gmail.com'}))).toBe(true);
    expect(await isVerifiedFamilyParent(await sign({email:'stranger@example.com'}))).toBe(false);
    expect(await isVerifiedFamilyParent(await sign({aud:['another-app']}))).toBe(false);
    expect(await isVerifiedFamilyParent(await sign({iss:'https://other.cloudflareaccess.com'}))).toBe(false);
    expect(await isVerifiedFamilyParent(await sign({exp:1}))).toBe(false);
    const valid=await sign();
    expect(await isVerifiedFamilyParent(valid.slice(0,valid.lastIndexOf('.')+1)+'AAAA')).toBe(false);
    expect(await isVerifiedFamilyParent(null)).toBe(false);
    expect(await isVerifiedFamilyParent('malformed')).toBe(false);
    vi.unstubAllGlobals();
});
