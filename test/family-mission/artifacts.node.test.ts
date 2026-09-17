import {describe,it,expect} from 'vitest';
import {validateArtifact,validArtifactId,artifactHeaders} from '@/lib/family-mission/artifact-policy';
describe('family artifacts',()=>{
 it('accepts complete interactive HTML and rejects malformed or oversized input',()=>{
  expect(validateArtifact({title:' Menú ',html:'<html><title>Menú</title><script>let x=1</script></html>'}).title).toBe('Menú');
  for(const value of [null,{}, {title:'x',html:'fragment'},{title:'x',html:'<html><title>x</title>'+ 'ñ'.repeat(250001)}])expect(()=>validateArtifact(value)).toThrow();
 });
 it('requires content IDs and isolates scripts from credentials, network and parent pages',()=>{
  expect(validArtifactId('a'.repeat(64))).toBe(true);expect(validArtifactId('../records')).toBe(false);
  const csp=artifactHeaders['Content-Security-Policy'];
  expect(csp).toContain('sandbox allow-scripts;');expect(csp).not.toContain('allow-same-origin');
  for(const rule of ["connect-src 'none'","form-action 'none'","frame-src 'none'","base-uri 'none'","frame-ancestors 'none'"])expect(csp).toContain(rule);
 });
});
