// @vitest-environment jsdom
import {expect,it,vi,beforeEach} from 'vitest';
import {render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MissionControl from '@/components/mission/MissionControl';
import {dateKey,addDays,validateRecord,type FamilyRecord} from '@/lib/family-mission/model';
vi.mock('@/components/mission/DailyDigest',()=>({default:()=> <div>Resumen diario</div>}));
vi.mock('@/components/mission/ActivityPlans',()=>({default:()=> <div>Actividades</div>}));
vi.mock('@/components/mission/FamilyChat',()=>({default:()=> <div>Chat familiar</div>}));
vi.mock('@/components/mission/DashboardLive',()=>({default:()=>null}));
vi.mock('@/components/mission/ApprovalTray',()=>({default:()=>null}));
const today=dateKey(), yesterday=addDays(today,-1);
const task=(id:string,patch:Partial<FamilyRecord>={}):FamilyRecord=>({...validateRecord({kind:'task',title:id,date:today,owner:'Dani',...patch}),id,revision:1});
beforeEach(()=>vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}}));
function setup(records:FamilyRecord[],view:'today'|'week'='today'){
 const request=vi.fn(async(url:string,init?:RequestInit)=>({ok:true,json:async()=>init?.method==='POST'?{record:{...JSON.parse(String(init.body)),revision:2}}:url.includes('/calendar')?{events:[]}:{records}}));
 vi.stubGlobal('fetch',request);render(<MissionControl view={view}/>);return request;
}
it('renders one pending section, no split task panels, and retains unrelated modules',async()=>{
 setup([task('Abierta')]);
 expect(await screen.findAllByRole('heading',{name:'Tareas pendientes'})).toHaveLength(1);
 for(const name of ['Necesita atención','Lo de hoy','En seguimiento','Por decidir','Un paso por delante.'])expect(screen.queryByRole('heading',{name,level:2})).toBeNull();
 for(const text of ['Resumen diario','Actividades','Chat familiar'])expect(screen.getByText(text)).toBeVisible();
 expect(screen.getByRole('heading',{name:'A la mesa'})).toBeVisible();
});
it('shows overdue open/waiting once, excludes done/cancelled/future, and carries work to the selected day without writes',async()=>{
 const old=task('Antigua',{date:yesterday}),waiting=task('Respuesta',{date:yesterday,status:'waiting',owner:'Cris',confirmed:false});
 const request=setup([old,old,waiting,task('Terminada',{status:'done'}),task('Archivada',{status:'cancelled',date:yesterday}),task('Futura',{date:addDays(today,2)})]);
 await screen.findByRole('checkbox',{name:'Completar Antigua'});
 expect(screen.getAllByText('Antigua')).toHaveLength(1);expect(screen.getAllByText('Respuesta')).toHaveLength(1);
 for(const title of ['Terminada','Archivada','Futura'])expect(screen.queryByText(title)).toBeNull();
 expect(screen.getAllByText('Desde ayer')).toHaveLength(2);
 const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Cris'}));
 expect(screen.queryByText('Antigua')).toBeNull();expect(screen.getByText('Respuesta')).toBeVisible();
 await user.click(screen.getByRole('button',{name:'Todos'}));await user.click(screen.getByRole('button',{name:'Siguiente'}));
 expect(screen.getAllByText('Antigua')).toHaveLength(1);expect(screen.getAllByText('Desde hace 2 días')).toHaveLength(2);
 expect(request.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);expect(old.date).toBe(yesterday);
});
it('offers Pendiente, Hecha and explicit archive; saving legacy waiting normalizes to open',async()=>{
 const request=setup([task('Legada',{status:'waiting'})]);const user=userEvent.setup();
 await user.click((await screen.findAllByRole('button',{name:/^Legada/}))[0]);
 const dialog=within(screen.getByRole('dialog'));const select=dialog.getByRole('combobox',{name:'Estado'});
 expect(within(select).getAllByRole('option').map(o=>o.textContent)).toEqual(['Pendiente','Hecha','Cancelada / archivada']);expect(select).toHaveValue('open');
 await user.click(dialog.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(JSON.parse(String(request.mock.calls.find(([,init])=>init?.method==='POST')![1]!.body))).toMatchObject({id:'Legada',status:'open'});
});
it('completes overdue waiting with one write preserving its date and removes the row',async()=>{
 const request=setup([task('Cerrar',{status:'waiting',date:yesterday})]);const user=userEvent.setup();
 await user.click(await screen.findByRole('checkbox',{name:'Completar Cerrar'}));
 await waitFor(()=>expect(screen.queryByText('Cerrar')).toBeNull());
 const writes=request.mock.calls.filter(([,init])=>init?.method==='POST');expect(writes).toHaveLength(1);
 expect(JSON.parse(String(writes[0][1]!.body))).toMatchObject({id:'Cerrar',date:yesterday,status:'done'});expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps recurrence replacements, completed/cancelled occurrences, and past unfinished occurrences correct',async()=>{
 const series=task('Diaria',{date:yesterday,recurrence:'daily'});
 const finished=task('Serie hecha',{recurrence:'daily'}),cancelled=task('Serie cancelada',{recurrence:'daily'});
 setup([series,task('Instancia',{sourceKey:`completion:${series.id}:${today}`,status:'waiting'}),task('Instancia antigua',{date:yesterday,sourceKey:`completion:${series.id}:${yesterday}`}),finished,task('Cierre',{status:'done',sourceKey:`completion:${finished.id}:${today}`}),cancelled,task('Cancelación',{status:'cancelled',sourceKey:`completion:${cancelled.id}:${today}`})]);
 await screen.findByRole('checkbox',{name:'Completar Instancia'});
 expect(screen.getAllByRole('checkbox')).toHaveLength(2);expect(screen.getByText('Instancia antigua')).toBeVisible();
 for(const title of ['Diaria','Serie hecha','Serie cancelada','Cierre','Cancelación'])expect(screen.queryByText(title)).toBeNull();
});
it('uses TAREAS in the week and keeps tasks on their actual dates without overdue duplication',async()=>{
 // Both dates are inside the selected week, regardless of the test execution day.
 const start=addDays(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));
 setup([task('Plan anterior',{date:start}),task('Plan futuro',{date:addDays(start,6)})],'week');
 expect(await screen.findAllByRole('heading',{name:'TAREAS'})).toHaveLength(7);expect(screen.queryByText('LO DEL DÍA')).toBeNull();
 expect(screen.getAllByText('Plan anterior')).toHaveLength(1);expect(screen.getAllByText('Plan futuro')).toHaveLength(1);
});
