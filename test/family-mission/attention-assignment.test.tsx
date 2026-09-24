// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MissionControl from '@/components/mission/MissionControl';
import {dateKey,validateRecord} from '@/lib/family-mission/model';
vi.mock('@/components/mission/DailyDigest',()=>({default:()=>null}));
vi.mock('@/components/mission/ActivityPlans',()=>({default:()=>null}));
vi.mock('@/components/mission/FamilyChat',()=>({default:()=>null}));
vi.mock('@/components/mission/DashboardLive',()=>({default:()=>null}));
vi.mock('@/components/mission/ApprovalTray',()=>({default:()=>null}));
it('assigns an unassigned event through Asignar and the existing editor save path',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
 const user=userEvent.setup();
 const event={...validateRecord({kind:'event',title:'Visita ficticia',date:dateKey(),owner:'Sin asignar',confirmed:true}),id:'event',revision:2};
 const request=vi.fn(async(url:string,init?:RequestInit)=>{
  if(init?.method==='POST')return {ok:true,json:async()=>({record:{...JSON.parse(String(init.body)),revision:3}})};
  return {ok:true,json:async()=>url.includes('/calendar')?{events:[]}:{records:[event]}};
 });
 vi.stubGlobal('fetch',request);
 render(<MissionControl view="today"/>);
 await user.click(await screen.findByRole('button',{name:'Asignar'}));
 const dialog=within(screen.getByRole('dialog',{name:'Editar plan'}));
 expect(dialog.getByLabelText('Hasta el día')).toBeVisible();
 expect(dialog.queryByLabelText('Estado')).toBeNull();
 expect(dialog.queryByText('Lista de preparación')).toBeNull();
 expect(dialog.queryByRole('button',{name:'Añadir elemento'})).toBeNull();
 await user.selectOptions(dialog.getByRole('combobox',{name:'Responsable'}),'Cris');
 await user.click(dialog.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 const writes=request.mock.calls.filter(([,init])=>init?.method==='POST');
 expect(writes).toHaveLength(1);
 expect(writes[0][0]).toBe('/api/family/records');
 expect(JSON.parse(String(writes[0][1]?.body))).toEqual({...event,owner:'Cris'});
 expect(screen.queryByRole('button',{name:'Asignar'})).toBeNull();
});
