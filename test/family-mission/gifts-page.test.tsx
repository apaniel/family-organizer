// @vitest-environment jsdom
import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GiftsPage from '@/app/gifts/page';
vi.mock('@/components/mission/FamilyChat',()=>({default:()=> <div>Family chat mounted</div>}));
vi.mock('@/components/mission/ApprovalTray',()=>({default:()=> <div>Approvals mounted</div>}));
const seeds=['Capibara','Zapatos tacones','Lupa','Plancha','Coche teledirigido'].map((title,i)=>({id:String(i),title,child:'Paula',occasion:'unassigned',status:'idea',createdBy:'Cris',createdAt:'2026-09-26',updatedAt:'2026-09-26',revision:1}));
let items:any[],request:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 items=structuredClone(seeds);
 request=vi.fn(async(_url:string,init?:RequestInit)=>{
  const b=init?.body?JSON.parse(String(init.body)):null;
  if(init?.method==='PATCH'){const item={...items.find(x=>x.id===b.id),...b,revision:b.revision+1};items=items.map(x=>x.id===b.id?item:x);return {ok:true,json:async()=>({item})};}
  if(init?.method==='POST'){const item={...b,id:'new',revision:1};items.push(item);return {ok:true,json:async()=>({item})};}
  if(init?.method==='DELETE'){items=items.filter(x=>x.id!==b.id);return {ok:true,json:async()=>({ok:true})};}
  return {ok:true,json:async()=>({items:structuredClone(items)})};
 });
 vi.stubGlobal('fetch',request);
});
it('renders the dashboard shell, five Paula ideas, birthdays, and an invitation for empty Alejandra',async()=>{
 render(<GiftsPage/>);
 expect(screen.getByRole('heading',{name:'Ideas de regalos'})).toBeVisible();
 expect(screen.getByRole('link',{name:'Regalos'})).toHaveAttribute('href','/gifts');
 expect(screen.getByText('Family chat mounted')).toBeVisible();expect(screen.getByText('Approvals mounted')).toBeVisible();
 const paula=within(await screen.findByRole('region',{name:'Paula'}));
 await screen.findByRole('heading',{name:'Capibara'});
 for(const seed of seeds)expect(paula.getByRole('heading',{name:seed.title})).toBeVisible();
 expect(paula.getByText(/28 de noviembre/)).toBeVisible();
 const alejandra=within(screen.getByRole('region',{name:'Alejandra'}));
 expect(alejandra.getByText(/29 de agosto/)).toBeVisible();expect(alejandra.getByText(/Añade la primera idea/)).toBeVisible();
});
it('persists occasion and bought changes using each latest revision',async()=>{
 const user=userEvent.setup();render(<GiftsPage/>);
 const occasion=await screen.findByLabelText('Ocasión de Capibara');
 for(const value of ['birthday','christmas','unassigned']){await user.selectOptions(occasion,value);await waitFor(()=>expect(occasion).toHaveValue(value));}
 const bought=screen.getByRole('checkbox',{name:'Comprado: Capibara'});await user.click(bought);await waitFor(()=>expect(bought).toBeChecked());await user.click(bought);await waitFor(()=>expect(bought).not.toBeChecked());
 const writes=request.mock.calls.filter(([,init])=>init?.method==='PATCH');
 expect(writes.map(([,init])=>JSON.parse(init.body))).toEqual([{id:'0',revision:1,occasion:'birthday'},{id:'0',revision:2,occasion:'christmas'},{id:'0',revision:3,occasion:'unassigned'},{id:'0',revision:4,status:'bought'},{id:'0',revision:5,status:'idea'}]);
});
it('adds and edits title, notes and child with server responses',async()=>{
 const user=userEvent.setup();render(<GiftsPage/>);await screen.findByRole('heading',{name:'Capibara'});
 const form=within(screen.getByRole('form',{name:'Nueva idea'}));
 await user.type(form.getByLabelText('Título'),'Libro');await user.selectOptions(form.getByLabelText('Para'),'Alejandra');await user.type(form.getByLabelText('Notas'),'Ilustrado');await user.click(form.getByRole('button',{name:'Añadir idea'}));
 expect(await screen.findByRole('heading',{name:'Libro'})).toBeVisible();
 await user.click(screen.getByRole('button',{name:'Editar Libro'}));const edit=within(screen.getByRole('form',{name:'Editar regalo'}));
 await user.clear(edit.getByLabelText('Título'));await user.type(edit.getByLabelText('Título'),'Cuentos');await user.clear(edit.getByLabelText('Notas'));await user.type(edit.getByLabelText('Notas'),'Con dibujos');await user.selectOptions(edit.getByLabelText('Para'),'Paula');await user.click(edit.getByRole('button',{name:'Guardar'}));
 expect(await within(screen.getByRole('region',{name:'Paula'})).findByRole('heading',{name:'Cuentos'})).toBeVisible();expect(screen.getByText('Con dibujos')).toBeVisible();
});
it('requires confirmation and a successful response before deleting',async()=>{
 const user=userEvent.setup(),confirm=vi.fn().mockReturnValue(false);vi.stubGlobal('confirm',confirm);render(<GiftsPage/>);
 const remove=await screen.findByRole('button',{name:'Eliminar Capibara'});await user.click(remove);expect(request.mock.calls.some(([,init])=>init?.method==='DELETE')).toBe(false);
 confirm.mockReturnValue(true);await user.click(remove);await waitFor(()=>expect(screen.queryByRole('heading',{name:'Capibara'})).toBeNull());expect(JSON.parse(request.mock.calls.find(([,init])=>init?.method==='DELETE')![1].body)).toEqual({id:'0',revision:1});
});
it('retains confirmed state on conflict and allows reloading the latest revision',async()=>{
 const user=userEvent.setup();render(<GiftsPage/>);const bought=await screen.findByRole('checkbox',{name:'Comprado: Capibara'});
 request.mockResolvedValueOnce({ok:false,status:409,json:async()=>({error:'Esta idea ha cambiado. Recarga las ideas.'})});
 await user.click(bought);expect(await screen.findByRole('alert')).toHaveTextContent('Esta idea ha cambiado');expect(bought).not.toBeChecked();
 items[0].revision=2;await user.click(screen.getByRole('button',{name:'Recargar ideas'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 const refreshed=await screen.findByRole('checkbox',{name:'Comprado: Capibara'});await user.click(refreshed);await waitFor(()=>expect(refreshed).toBeChecked());expect(JSON.parse(request.mock.calls.at(-1)![1].body).revision).toBe(2);
});
it('keeps confirmed state on network errors and rejects malformed success responses',async()=>{
 const user=userEvent.setup();render(<GiftsPage/>);const bought=await screen.findByRole('checkbox',{name:'Comprado: Capibara'});
 request.mockRejectedValueOnce(new Error('offline'));await user.click(bought);expect(await screen.findByRole('alert')).toBeVisible();expect(bought).not.toBeChecked();
 request.mockResolvedValueOnce({ok:true,json:async()=>({})});await user.click(bought);expect(bought).not.toBeChecked();expect(screen.getByRole('alert')).toBeVisible();
});
it('waits for the server before showing a changed status',async()=>{
 const user=userEvent.setup();render(<GiftsPage/>);const bought=await screen.findByRole('checkbox',{name:'Comprado: Capibara'});
 let resolve!:(value:any)=>void;request.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await user.click(bought);expect(bought).not.toBeChecked();expect(bought).toBeDisabled();
 resolve({ok:true,json:async()=>({item:{...seeds[0],status:'bought',revision:2}})});await waitFor(()=>expect(bought).toBeChecked());
});
