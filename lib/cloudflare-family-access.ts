// Only cryptographically verified identities may activate a new family device.
const ISSUER = 'https://apalabs.cloudflareaccess.com';
const AUDIENCE = '2f8201ee1f9854a7746e6f39e4f02330805a69327108dec11a98decebfe61bf1';
const PARENT_EMAILS = new Set(['apavicio@gmail.com', 'dapamar90@gmail.com']);
type SigningKey = JsonWebKey & { kid?: string };
let cached: { keys: SigningKey[]; expires: number } | undefined;
function bytes(value: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
function decode(value: string) { return JSON.parse(new TextDecoder().decode(bytes(value))); }
export async function isVerifiedFamilyParent(token: string | null): Promise<boolean> {
    if (!token || token.length > 16000) return false;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const header = decode(parts[0]);
        const claims = decode(parts[1]);
        const now = Date.now() / 1000;
        if (header.alg !== 'RS256' || typeof header.kid !== 'string' || claims.iss !== ISSUER ||
            !Array.isArray(claims.aud) || !claims.aud.includes(AUDIENCE) ||
            typeof claims.exp !== 'number' || claims.exp <= now ||
            (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now)) ||
            typeof claims.email !== 'string' || !PARENT_EMAILS.has(claims.email.toLowerCase())) return false;
        if (!cached || cached.expires <= Date.now() || !cached.keys.some(k => k.kid === header.kid)) {
            const response = await fetch(ISSUER + '/cdn-cgi/access/certs', {
                redirect: 'manual', signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) return false;
            const data = await response.json();
            if (!Array.isArray(data.keys)) return false;
            cached = { keys: data.keys, expires: Date.now() + 600000 };
        }
        const jwk = cached.keys.find(k => k.kid === header.kid && k.kty === 'RSA');
        if (!jwk) return false;
        const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    } catch { return false; }
}
