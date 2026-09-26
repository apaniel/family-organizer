import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const component=readFileSync(new URL('../../components/mission/CapabilityBacklog.tsx',import.meta.url),'utf8');

describe('Ideas para Rufus',()=>{
 it('keeps the Rufus chat available on the backlog page',()=>{
  expect(component).toContain("import FamilyChat from './FamilyChat';");
  expect(component).toContain('<FamilyChat/>');
 });
});

it('links Regalos with a Gift icon from both dashboard navigation shells',()=>{
 expect(component).toMatch(/href="\/gifts"><Gift[^>]*\/>Regalos/);
 const dashboard=readFileSync(new URL('../../components/mission/MissionControl.tsx',import.meta.url),'utf8');
 expect(dashboard).toContain("['/gifts',Gift,'Regalos'");
});
