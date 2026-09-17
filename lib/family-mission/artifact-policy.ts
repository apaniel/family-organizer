export const artifactHeaders = {
 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'private, no-store',
 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
 'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
 'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()'
};
export function validateArtifact(raw:unknown):{title:string,html:string} {
 if(!raw || typeof raw!=='object')throw new Error('Invalid artifact');
 const {title,html}=raw as any;
 if(typeof title!=='string'||!title.trim()||title.length>120)throw new Error('Title must contain 1–120 characters');
 if(typeof html!=='string'||!html.trim()||new TextEncoder().encode(html).length>500000)throw new Error('HTML must contain 1–500000 bytes');
 if(!/<html[\s>]/i.test(html)||!/<title[\s>]/i.test(html))throw new Error('Provide a complete HTML document with title');
 return {title:title.trim(),html};
}
export const validArtifactId=(id:string)=>/^[a-f0-9]{64}$/.test(id);
