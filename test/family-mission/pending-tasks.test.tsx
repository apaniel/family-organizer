// @vitest-environment jsdom
import {expect,it,vi,beforeEach} from 'vitest';
import {render,screen,within,waitFor,act} from '@testing-library/react';
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
 const request=vi.fn(async(url:string,init?:RequestInit):Promise<any>=>({ok:true,json:async()=>init?.method==='POST'?{record:{...JSON.parse(String(init.body)),revision:2}}:url.includes('/calendar')?{events:[]}:{records,taskAvailable:true,taskRefreshedAt:new Date().toISOString()}}));
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

it('fails closed on initial unavailability without claiming all tasks are done',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('/calendar')?{events:[]}:{records:[task('Stale')],taskAvailable:false,taskRefreshedAt:null}})));
 render(<MissionControl view="today"/>);await screen.findByText('Tareas no disponibles');expect(screen.queryByText('Todo al día')).toBeNull();expect(screen.queryByText('Stale')).toBeNull();
});
it('clears old task rows after a failed refresh and preserves meals',async()=>{
 const request=setup([task('Previously current'),{...validateRecord({kind:'meal',title:'Pasta preservada',date:today}),id:'meal',revision:1}]);await screen.findByText('Previously current');
 request.mockImplementation(async(url:string)=>({ok:!url.includes('/records'),json:async()=>url.includes('/calendar')?{events:[]}:{error:'Unavailable'}}) as any);
 // Use the same public refresh event as the live Dashboard.
 const {DASHBOARD_REFRESH}=await import('@/components/mission/dashboard-refresh');await act(async()=>{window.dispatchEvent(new Event(DASHBOARD_REFRESH));});
 await screen.findByText('Tareas no disponibles');expect(screen.queryByText('Previously current')).toBeNull();expect(screen.queryByText('Todo al día')).toBeNull();expect(screen.getByText('Pasta preservada')).toBeVisible();
});
it('retains a failed submission key for retries and creates a new key for a new intent',async()=>{
 const request=setup([]);const user=userEvent.setup();await screen.findByText('Todo al día');await user.click(screen.getByRole('button',{name:'Añadir tarea'}));const dialog=within(screen.getByRole('dialog'));await user.type(dialog.getByRole('textbox',{name:/Qué hay/}),'Intento');
 const original=request.getMockImplementation()!;let attempts=0;
 request.mockImplementation(async(url:string,init?:RequestInit)=>{if(init?.method==='POST'){attempts++;return {ok:attempts>1,json:async()=>attempts>1?{record:{...JSON.parse(String(init.body)),id:'created',revision:1}}:{error:'Pending'}};}return original(url,init);});
 await user.click(dialog.getByRole('button',{name:'Guardar'}));await screen.findAllByText('Pending');await user.click(dialog.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 await user.click(screen.getByRole('button',{name:'Añadir tarea'}));const next=within(screen.getByRole('dialog'));await user.type(next.getByRole('textbox',{name:/Qué hay/}),'Intento');await user.click(next.getByRole('button',{name:'Guardar'}));
 const keys=request.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>(init!.headers as Record<string,string>)['Idempotency-Key']);expect(keys[0]).toBe(keys[1]);expect(keys[2]).not.toBe(keys[0]);
});

it('expires a displayed snapshot even when background refresh cannot run',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');try{setup([task('Expires')]);await act(async()=>{await Promise.resolve();});expect(screen.getByText('Expires')).toBeVisible();await act(async()=>{vi.advanceTimersByTime(90001);});expect(screen.queryByText('Expires')).toBeNull();expect(screen.queryByText('Todo al día')).toBeNull();expect(screen.getByText('Tareas no disponibles')).toBeVisible();}finally{vi.useRealTimers();}
});
