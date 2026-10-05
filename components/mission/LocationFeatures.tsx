'use client';
import {useCallback,useEffect,useState} from 'react';
import type {FamilyRecord} from '@/lib/family-mission/model';
import {placeDate,locationCards,type Place,type LocationLink,type LocationAttention} from '@/lib/family-mission/location-model';
type Props={records:FamilyRecord[];editing?:FamilyRecord|null};
export function LocationFeatures({records,editing}:Props){
 const [attention,setAttention]=useState<LocationAttention[]>([]);
 const [places,setPlaces]=useState<Place[]>([]),[links,setLinks]=useState<LocationLink[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[manage,setManage]=useState(false);
 const [draft,setDraft]=useState<Partial<Place>>({name:'',latitude:undefined,longitude:undefined,radius:150,person:'Dani',timezone:'Europe/Madrid'});
 const [placeId,setPlaceId]=useState(''),[mode,setMode]=useState<'arrival'|'nearby'>('arrival'),[recurring,setRecurring]=useState(false),[expires,setExpires]=useState(placeDate('Europe/Madrid'));
 const load=useCallback(async()=>{try{const r=await fetch('/api/family/locations',{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.error);if(!Array.isArray(d.places)||!Array.isArray(d.links))throw new Error('Lugares no disponibles');setPlaces(d.places);setLinks(d.links);setAttention(d.attention||[]);}catch(e){setError(e instanceof Error?e.message:'Lugares no disponibles');}},[]);
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),60000);return()=>clearInterval(timer);},[load]);
 const link=editing?links.find(l=>l.target.id===editing.id&&l.target.kind===editing.kind&&(editing.kind!=='task'||l.target.listId===editing.googleTaskListId)):undefined;
 useEffect(()=>{setPlaceId(link?.placeId||'');setMode(link?.mode||'arrival');setRecurring(link?.recurring||false);setExpires(link?.expires||placeDate(places.find(p=>p.id===link?.placeId)?.timezone||'Europe/Madrid'));},[link,editing?.id,editing?.date]);
 async function mutate(data:unknown,remove=false){setBusy(true);setError('');try{const r=await fetch('/api/family/locations',{method:remove?'DELETE':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),d=await r.json();if(!r.ok)throw new Error(d.error);await load();return true;}catch(e){setError(e instanceof Error?e.message:'No se pudo guardar');return false;}finally{setBusy(false);}}
 const cards=locationCards(places,links,records,Date.now(),attention);
 const eligible=editing&&editing.id&&['task','event'].includes(editing.kind)&&(editing.kind!=='task'||editing.googleTaskListId);
 async function saveLink(enabled=false){if(!editing)return;const place=places.find(p=>p.id===placeId);if(!place)return;await mutate({kind:'link',id:link?.id,revision:link?.revision,placeId,person:place.person,target:{kind:editing.kind,id:editing.id,...(editing.kind==='task'?{listId:editing.googleTaskListId}:{})},mode,recurring,expires,enabled,confirm:enabled});}
 return <section className="mc-card mc-location" aria-label="Lugares y avisos privados">
 <h2>{editing?'Lugar vinculado':'Recados y lugares'}</h2>
 {editing?.location&&<p>Google Calendar: {editing.location}</p>}
 {eligible&&<div className="mc-form"><label>Lugar guardado<select value={placeId} onChange={e=>{setPlaceId(e.target.value);if(!link)setExpires(placeDate(places.find(p=>p.id===e.target.value)?.timezone||'Europe/Madrid'));}}><option value="">Selecciona un lugar</option>{places.map(p=><option key={p.id} value={p.id}>{p.name} · {p.person}</option>)}</select></label>
 <label>Aviso<select value={mode} onChange={e=>setMode(e.target.value as 'arrival'|'nearby')}><option value="arrival">Al llegar (desde fuera)</option><option value="nearby">Recado cercano</option></select></label>
 <label>Válido hasta<input type="date" value={expires} onChange={e=>setExpires(e.target.value)}/></label><label><input type="checkbox" checked={recurring} onChange={e=>setRecurring(e.target.checked)}/>Repetir en nuevas visitas</label>
 <p>{link?.enabled?'Aviso privado confirmado.':'Aviso desactivado.'} Ubicación reciente necesaria; una llegada nunca marca la tarea como hecha.</p>
 <div className="mc-form-actions"><button type="button" disabled={busy||!placeId} onClick={()=>void saveLink()}>Guardar vínculo sin avisos</button>{link&&<button type="button" disabled={busy} onClick={()=>void mutate({kind:'link',id:link.id,revision:link.revision},true)}>Quitar vínculo</button>}</div>
 {link&&!link.enabled&&<details><summary>Activar este aviso</summary><p>Confirmo usar mi ubicación para este aviso hasta {expires}. Se enviará solo al WhatsApp privado de Dani. La entrega requiere activar el consumidor tras revisión.</p><button type="button" disabled={busy||!placeId} onClick={()=>void saveLink(true)}>Confirmar y activar este aviso privado</button></details>}
 </div>}
 {!editing&&<>{cards.length?cards.map(c=><p key={c.id}><strong>{c.title}</strong> · {c.place} · {c.person}<br/><small>{c.status}</small></p>):<p>Vincula un pendiente a un lugar desde su editor. Los avisos empiezan desactivados.</p>}<p><small>Cris: ubicación no disponible mientras su dispositivo no envíe datos.</small></p></>}
 <button type="button" onClick={()=>setManage(!manage)}>{manage?'Cerrar lugares':'Gestionar mis lugares'}</button>
 {manage&&<div className="mc-form">{places.map(p=><div key={p.id}><strong>{p.name}</strong> · {p.radius} m · {p.person} <button type="button" onClick={()=>setDraft(p)}>Editar</button> <button type="button" disabled={busy} onClick={()=>void mutate({kind:'place',id:p.id,revision:p.revision},true)}>Eliminar</button></div>)}
 <label>Nombre<input maxLength={100} value={draft.name||''} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
 <label>Persona<select value={draft.person} onChange={e=>setDraft({...draft,person:e.target.value as 'Dani'|'Cris'})}><option>Dani</option><option>Cris</option></select></label>
 <div className="mc-form-row"><label>Latitud<input type="number" step="any" min={-90} max={90} value={draft.latitude??''} onChange={e=>setDraft({...draft,latitude:e.target.value===''?undefined:Number(e.target.value)})}/></label><label>Longitud<input type="number" step="any" min={-180} max={180} value={draft.longitude??''} onChange={e=>setDraft({...draft,longitude:e.target.value===''?undefined:Number(e.target.value)})}/></label></div>
 <label>Radio (metros)<input type="number" min={50} max={3000} value={draft.radius} onChange={e=>setDraft({...draft,radius:Number(e.target.value)})}/></label><label>Zona horaria<input value={draft.timezone} onChange={e=>setDraft({...draft,timezone:e.target.value})}/></label>
 <button type="button" disabled={busy} onClick={()=>void mutate({kind:'place',...draft}).then(ok=>{if(ok)setDraft({name:'',radius:150,person:draft.person,timezone:'Europe/Madrid'});})}>Guardar lugar</button><button type="button" onClick={()=>setDraft({name:'',radius:150,person:draft.person,timezone:'Europe/Madrid'})}>Nuevo lugar</button></div>}
 {error&&<p role="alert">{error}</p>}
 </section>;
}
