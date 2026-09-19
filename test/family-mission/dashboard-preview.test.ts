// @vitest-environment jsdom
import {describe,expect,it} from 'vitest';
import {activeDashboardPreview,discardDashboardPreview,parsePreviewAnswer,setDashboardPreviewMinimized,startDashboardPreview} from '../../components/mission/dashboard-preview';

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

describe('live dashboard preview',()=>{
 it('changes the live page and restores it only when discarded',()=>{
  document.body.innerHTML='<button class="fc-send" style="background:blue">Enviar</button>';
  startDashboardPreview('preview-1','document.querySelector(".fc-send").style.background="yellow";');
  expect((document.querySelector('.fc-send') as HTMLElement).style.background).toBe('yellow');
  discardDashboardPreview();
  expect((document.querySelector('.fc-send') as HTMLElement).style.background).toBe('blue');
 });

 it('rejects preview code with network or storage access',()=>{
  expect(()=>startDashboardPreview('preview-2','fetch("/api/family/records")')).toThrow('Vista previa no segura');
  expect(()=>startDashboardPreview('preview-3','localStorage.clear()')).toThrow('Vista previa no segura');
 });

 it('keeps the minimized banner state with the active preview',()=>{
  document.body.innerHTML='<button class="fc-send">Enviar</button>';
  startDashboardPreview('preview-4','document.querySelector(".fc-send").style.color="red";');
  setDashboardPreviewMinimized(true);
  expect(activeDashboardPreview()).toMatchObject({id:'preview-4',minimized:true});
  discardDashboardPreview();
 });
});
