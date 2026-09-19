// @vitest-environment jsdom
import {describe,expect,it} from 'vitest';
import {buildPreviewDocument,parsePreviewAnswer} from '../../components/mission/dashboard-preview';

describe('dashboard preview answers',()=>{
 it('separates the visual preview script from the family-facing reply',()=>{
  const parsed=parsePreviewAnswer('He preparado una vista previa.\n```apalas-preview-js\ndocument.querySelector("h1").textContent="Nuevo";\n```');
  expect(parsed.text).toBe('He preparado una vista previa.');
  expect(parsed.script).toBe('document.querySelector("h1").textContent="Nuevo";');
 });

 it('leaves ordinary replies unchanged',()=>{
  expect(parsePreviewAnswer('Hecho.')).toEqual({text:'Hecho.',script:null});
 });
});

describe('isolated dashboard preview',()=>{
 it('builds a network-isolated visual clone without live scripts or chat chrome',()=>{
  document.documentElement.innerHTML='<head><style>h1{color:red}</style><script>window.bad=true</script></head><body style="overflow:hidden" data-scroll-locked="1"><main><h1>Hoy</h1></main><button class="fc-launch">Chat</button><div role="dialog">Conversación</div></body>';
  const html=buildPreviewDocument('document.querySelector("h1").textContent="Mañana";');
  expect(html).toContain("default-src 'none'");
  expect(html).toContain('document.querySelector("h1").textContent="Mañana";');
  expect(html).toContain('h1{color:red}');
  expect(html).not.toContain('window.bad=true');
  expect(html).not.toContain('Conversación');
  expect(html).not.toContain('fc-launch');
  expect(html).not.toContain('data-scroll-locked');
 });

 it('neutralizes a closing script tag inside generated preview code',()=>{
  const html=buildPreviewDocument('document.body.dataset.example="</script>";');
  expect(html).not.toContain('dataset.example="</script>"');
  expect(html).toContain('<\\/script>');
 });
});
