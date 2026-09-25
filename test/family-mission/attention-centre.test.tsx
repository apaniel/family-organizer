// @vitest-environment jsdom
import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within} from '@testing-library/react';
import AttentionCentre from '@/components/mission/AttentionCentre';
import {validateRecord,type FamilyRecord} from '@/lib/family-mission/model';
const today='2026-09-24';
const record=(patch:Partial<FamilyRecord>={}):FamilyRecord=>({...validateRecord({kind:'task',title:'Mochila',date:'2026-09-23',owner:'Dani',confirmed:true}),id:'task',revision:4,...patch});
function setup(records:FamilyRecord[],busy=false){
 const callbacks={onOpen:vi.fn(),onComplete:vi.fn(),onTriage:vi.fn(),onConfirm:vi.fn()};
 render(<AttentionCentre records={records} today={today} busy={busy} {...callbacks}/>);
 return callbacks;
}
describe('attention card interactions',()=>{
 it('opens the editor by title and dispatches the three overdue actions using dashboard today',()=>{
  const task=record();const cb=setup([task]);
  fireEvent.click(screen.getByRole('button',{name:'Mochila'}));
  expect(cb.onOpen).toHaveBeenCalledWith(task);
  const actions=screen.getByRole('group',{name:'Acciones para Mochila'});
  expect(within(actions).getAllByRole('button').map(b=>b.textContent)).toEqual(['Hecha','Mañana','Esperando']);
  fireEvent.click(screen.getByRole('button',{name:'Hecha'}));
  expect(cb.onComplete).toHaveBeenCalledWith(task);
  fireEvent.click(screen.getByRole('button',{name:'Mañana'}));
  expect(cb.onTriage).toHaveBeenCalledWith(task,{type:'reschedule',date:'2026-09-25'});
  fireEvent.click(screen.getByRole('button',{name:'Esperando'}));
  expect(cb.onTriage).toHaveBeenCalledWith(task,{type:'wait'});
 });
 it('keeps secondary controls collapsed and only saves a chosen date when submitted',()=>{
  const task=record();const cb=setup([task]);
  const summary=screen.getByText('Más opciones');
  const details=summary.closest('details')!;
  expect(details.open).toBe(false);
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  fireEvent.change(screen.getByLabelText('Nueva fecha para Mochila'),{target:{value:'2026-10-01'}});
  expect(cb.onTriage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Cambiar fecha'}));
  expect(cb.onTriage).toHaveBeenCalledWith(task,{type:'reschedule',date:'2026-10-01'});
  fireEvent.click(screen.getByRole('button',{name:'Archivar'}));
  expect(cb.onTriage).toHaveBeenCalledWith(task,{type:'cancel'});
  expect(screen.getByText(/Revisión diaria de datos/).closest('details')).not.toHaveAttribute('open');
 });
 it('routes review, confirmation, assignment and reactivation to existing flows',()=>{
  const steps=record({id:'steps',title:'Preparar material',status:'done',checklist:[{text:'Libro',done:false}]});
  const waiting=record({id:'waiting',title:'Respuesta',date:today,status:'waiting'});
  const event=record({id:'event',kind:'event',title:'Excursión',date:today,confirmed:false,owner:''});
  const cb=setup([steps,waiting,event]);
  expect(screen.queryByRole('button',{name:'Revisar pasos'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Reactivar'}));
  expect(cb.onTriage).toHaveBeenCalledWith(waiting,{type:'reactivate'});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar'}));
  expect(cb.onConfirm).toHaveBeenCalledExactlyOnceWith(event);
  fireEvent.click(screen.getByRole('button',{name:'Asignar'}));
  expect(cb.onOpen).toHaveBeenCalledWith(event);
  expect(screen.queryByText('Marcada como hecha, pero todavía faltan pasos')).toBeNull();
 });
 it('shows only the editor link for a read-only card',()=>{
  setup([record({readOnly:true,status:'waiting',confirmed:false,owner:'',source:'Google Calendar'})]);
  expect(screen.getAllByRole('button').map(b=>b.textContent)).toEqual(['Mochila']);
  expect(screen.queryByText('Más opciones')).toBeNull();
  expect(screen.getByText(/Google Calendar · solo lectura · editar allí/)).toBeVisible();
 });
 it('disables writes while saving',()=>{
  setup([record()],true);
  for(const name of ['Hecha','Mañana','Esperando'])expect(screen.getByRole('button',{name})).toBeDisabled();
  fireEvent.click(screen.getByText('Más opciones'));
  expect(screen.getByLabelText('Nueva fecha para Mochila')).toBeDisabled();
  expect(screen.getByRole('button',{name:'Archivar'})).toBeDisabled();
 });
});

describe('bounded attention preview',()=>{
 it('shows four priority cards and hides the remainder in a native collapsed disclosure',()=>{
  const records=Array.from({length:7},(_,i)=>record({id:String(i),title:`Asunto ${i}`,date:`2026-09-${10+i}`}));
  setup([...records].reverse());
  const cards=screen.getAllByRole('article');
  expect(cards.map(card=>within(card).getByRole('button',{name:/Asunto/}).textContent)).toEqual(records.map(r=>r.title));
  expect(cards.filter(card=>!card.closest('details'))).toHaveLength(4);
  cards.slice(0,4).forEach(card=>expect(card).toBeVisible());
  cards.slice(4).forEach(card=>expect(card).not.toBeVisible());
  const summary=screen.getByText('Ver 3 más');
  expect(summary.tagName).toBe('SUMMARY');
  const disclosure=summary.parentElement as HTMLDetailsElement;
  expect(disclosure.tagName).toBe('DETAILS');
  expect(disclosure.firstElementChild).toBe(summary);
  expect(disclosure.open).toBe(false);
  fireEvent.click(summary);
  expect(disclosure.open).toBe(true);
  cards.forEach(card=>expect(card).toBeVisible());
  fireEvent.click(summary);
  expect(disclosure.open).toBe(false);
  cards.slice(4).forEach(card=>expect(card).not.toBeVisible());
 });
 it('does not show an empty disclosure for four or fewer items',()=>{
  setup(Array.from({length:4},(_,i)=>record({id:String(i),title:`Asunto ${i}`})));
  expect(screen.queryByText(/Ver \d+ más/)).toBeNull();
  expect(screen.getAllByRole('article')).toHaveLength(4);
 });
});
