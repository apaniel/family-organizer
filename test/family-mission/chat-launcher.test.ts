import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const component=readFileSync(new URL('../../components/mission/FamilyChat.tsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('../../components/mission/family-chat.css',import.meta.url),'utf8');

describe('Rufus launcher',()=>{
 it('renders only the approved star logo with an accessible name',()=>{
  expect(component).toContain('aria-label="Abrir Rufus"');
  expect(component).toContain('title="Abrir Rufus"');
  expect(component).toContain('<span aria-hidden="true">✦</span>');
  expect(component).not.toContain('Hablar con Rufus</button>');
 });
 it('uses the approved circular logo dimensions',()=>{
  expect(styles).toContain('.fc-launch{position:fixed;right:22px;bottom:24px;z-index:35;display:flex;align-items:center;justify-content:center;border:0;border-radius:50%;width:52px;height:52px;padding:0;background:#3849a9;color:white;font-size:25px;font-weight:700;box-shadow:0 4px 20px #26366f26}');
 });
});
