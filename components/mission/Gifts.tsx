'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {CalendarDays,Gift,Lightbulb,Sun,Utensils} from 'lucide-react';
import type {GiftIdea,GiftFields} from '@/lib/family-mission/gift-model';
import ApprovalTray from './ApprovalTray';
import FamilyChat from './FamilyChat';
import './mission.css';
import './gifts.css';

const occasions = {unassigned:'Sin asignar',birthday:'Cumpleaños',christmas:'Navidad'};
function isGift(value: any): value is GiftIdea {
 return value && typeof value.id === 'string' && typeof value.title === 'string' &&
  ['Paula','Alejandra'].includes(value.child) && Object.hasOwn(occasions,value.occasion) &&
  ['idea','bought'].includes(value.status) && Number.isSafeInteger(value.revision) && value.revision > 0;
}
function GiftForm({item,busy,onSave,onCancel}:{item?:GiftIdea;busy:boolean;onSave:(fields:GiftFields)=>Promise<boolean>;onCancel?:()=>void}) {
 const [title,setTitle] = useState(item?.title || ''), [notes,setNotes] = useState(item?.notes || '');
 const [child,setChild] = useState<GiftIdea['child']>(item?.child || 'Paula');
 async function submit(e: FormEvent) {
  e.preventDefault();
  if (await onSave({title:title.trim(),notes:notes.trim(),child,occasion:item?.occasion || 'unassigned',status:item?.status || 'idea'})) {
   setTitle('');setNotes('');
  }
 }
 return <form className="mc-form gift-form" aria-label={item?'Editar regalo':'Nueva idea'} onSubmit={submit}>
  <fieldset disabled={busy}>
   <div className="gift-form-row"><label>Título<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
   <label>Para<select value={child} onChange={e=>setChild(e.target.value as GiftIdea['child'])}><option>Paula</option><option>Alejandra</option></select></label></div>
   <label>Notas<textarea rows={2} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
   <div className="gift-actions"><button className="mc-primary" disabled={!title.trim()}>{item?'Guardar':'Añadir idea'}</button>{onCancel&&<button type="button" onClick={onCancel}>Cancelar</button>}</div>
  </fieldset>
 </form>;
}
export default function Gifts() {
 const [items,setItems] = useState<GiftIdea[]>([]), [loading,setLoading] = useState(true), [busy,setBusy] = useState(false);
 const [error,setError] = useState(''), [editing,setEditing] = useState<string|null>(null);
 const load = useCallback(async()=>{
  setLoading(true);setError('');
  try {
   const response = await fetch('/api/family/gifts',{cache:'no-store'}), data = await response.json();
   if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las ideas.');
   if (!Array.isArray(data.items) || !data.items.every(isGift)) throw new Error('No se pudieron verificar las ideas.');
   setItems(data.items);setEditing(null);
  } catch (e) { setError(e instanceof Error?e.message:'No se pudieron cargar las ideas.'); }
  finally { setLoading(false); }
 },[]);
 useEffect(()=>{void load();},[load]);
 async function save(method: 'POST'|'PATCH'|'DELETE', fields: Partial<GiftFields>, item?: GiftIdea): Promise<boolean> {
  setBusy(true);setError('');
  try {
   const payload = {...fields,...(item?{id:item.id,revision:item.revision}:{})};
   const response = await fetch('/api/family/gifts',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const data = await response.json();
   if (!response.ok) throw new Error(data.error || 'No se pudo guardar. Inténtalo de nuevo.');
   if (method === 'DELETE') {
    if (data.ok !== true) throw new Error('No se pudo verificar la eliminación. Recarga las ideas.');
    setItems(current=>current.filter(x=>x.id!==item!.id));
   } else {
    if (!isGift(data.item) || data.item.revision !== (item?item.revision+1:1) ||
     (item && data.item.id !== item.id) || Object.entries(fields).some(([key,value])=>data.item[key]!==value)) {
     throw new Error('No se pudo verificar el cambio. Recarga las ideas.');
    }
    setItems(current=>item?current.map(x=>x.id===item.id?data.item:x):[...current,data.item]);
   }
   setEditing(null);
   return true;
  } catch (e) { setError(e instanceof Error?e.message:'No se pudo guardar. Inténtalo de nuevo.');return false; }
  finally { setBusy(false); }
 }
 return <div className="mission"><ApprovalTray/>
  <aside className="mc-sidebar"><Link className="mc-brand" href="/"><span>a.</span>apalas<span className="mc-brand-dot">●</span></Link><div className="mc-sidebar-label">NUESTRO DÍA A DÍA</div>
   <nav aria-label="Principal"><Link href="/"><Sun size={20}/>Hoy y mañana</Link><Link href="/family-calendar"><CalendarDays size={20}/>Calendario</Link><Link href="/week"><Utensils size={20}/>Plan semanal</Link><Link href="/agent-backlog"><Lightbulb size={20}/>Ideas para Rufus</Link><Link className="active" aria-current="page" href="/gifts"><Gift size={20}/>Regalos</Link></nav>
   <div className="mc-sidebar-bottom"><div className="mc-hermes"><span className="mc-live-dot"/>Rufus · Family COO<small>Ideas para celebrar en familia.</small></div></div>
  </aside>
  <div className="mc-workspace"><header className="mc-topbar"><span>EN FAMILIA <span className="mc-slash">/</span> Regalos</span><a href="/cdn-cgi/access/logout">Salir</a></header>
   <main className="mc-content gifts-page"><div className="mc-page-heading"><div><h1>Ideas de regalos</h1><p>Guarda ideas para sus cumpleaños y Navidad.</p></div><button disabled={busy||loading} onClick={()=>void load()}>Recargar ideas</button></div>
    {error&&<div className="mc-error" role="alert">{error}</div>}
    <div className="mc-card gift-add"><h2>Nueva idea</h2><GiftForm busy={busy||loading} onSave={fields=>save('POST',fields)}/></div>
    {loading?<p role="status">Cargando ideas…</p>:<div className="gifts-grid">{(['Paula','Alejandra'] as const).map(child=><section className="gift-section" aria-labelledby={'gifts-'+child} key={child}>
     <header><h2 id={'gifts-'+child}>{child}</h2><p>Cumpleaños · {child==='Paula'?'28 de noviembre':'29 de agosto'}</p></header>
     {items.filter(item=>item.child===child).map(item=><article className="mc-card gift-item" key={item.id}>
      {editing===item.id?<GiftForm item={item} busy={busy} onSave={fields=>save('PATCH',fields,item)} onCancel={()=>setEditing(null)}/>:<>
       <h3>{item.title}</h3>{item.notes&&<p className="gift-notes">{item.notes}</p>}
       <div className="gift-controls"><label>Ocasión<select aria-label={'Ocasión de '+item.title} disabled={busy} value={item.occasion} onChange={e=>void save('PATCH',{occasion:e.target.value as GiftIdea['occasion']},item)}>{Object.entries(occasions).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="gift-bought"><input type="checkbox" aria-label={'Comprado: '+item.title} checked={item.status==='bought'} disabled={busy} onChange={e=>void save('PATCH',{status:e.target.checked?'bought':'idea'},item)}/>Comprado</label></div>
       <div className="gift-actions"><button disabled={busy} aria-label={'Editar '+item.title} onClick={()=>setEditing(item.id)}>Editar</button><button disabled={busy} className="gift-delete" aria-label={'Eliminar '+item.title} onClick={()=>{if(confirm(`¿Eliminar «${item.title}»?`))void save('DELETE',{},item);}}>Eliminar</button></div>
      </>}
     </article>)}
     {!items.some(item=>item.child===child)&&<p className="mc-card gift-empty">Añade la primera idea para {child} en el formulario de arriba.</p>}
    </section>)}</div>}
   </main>
  </div><FamilyChat/>
 </div>;
}
