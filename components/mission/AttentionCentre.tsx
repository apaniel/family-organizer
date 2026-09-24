'use client';
import {attentionLabels,attentionReport,attentionMetadata,type TriageAction} from '@/lib/family-mission/attention';
import type {FamilyRecord} from '@/lib/family-mission/model';

export default function AttentionCentre({records,today,onOpen,busy,onTriage,onComplete}:{records:FamilyRecord[];today:string;onOpen:(record:FamilyRecord)=>void;busy:boolean;onTriage:(record:FamilyRecord,action:TriageAction)=>void;onComplete:(record:FamilyRecord)=>void}){
 const report=attentionReport(records,today);
 const healthLabels={overdue:'Tareas vencidas',waiting:'Tareas esperando respuesta',unconfirmed:'Elementos sin confirmar',incomplete:'Cierres con lista incompleta',stale:'Tareas vencidas hace 7 días o más',unassigned:'Elementos sin responsable',approaching:'Planes sin confirmar en los próximos 7 días'};
 return <section className="mc-attention" aria-label="Necesita atención">
  <div className="mc-section-heading"><h2>Necesita atención</h2><small>{report.items.length} elementos</small></div>
  <div className="mc-card mc-small-card">
   <p className="mc-muted">{Object.entries(report.counts).filter(([,count])=>count>0).map(([reason,count])=>`${attentionLabels[reason as keyof typeof attentionLabels]}: ${count}`).join(' · ')}</p>
   {!report.items.length?<p className="mc-muted">No hay asuntos que necesiten atención en los datos cargados.</p>:<details open><summary>Revisar {report.items.length} elementos</summary><div className="mc-attention-list">{report.items.map(({record,reasons})=><article className="mc-attention-row" key={record.id}>
    <button className="mc-task-body" onClick={()=>onOpen(record)}><strong>{record.title}</strong><span>{attentionMetadata(record,today,records)}</span><span>{record.date} · {reasons.map(r=>attentionLabels[r]).join(' · ')}</span></button>
    {!record.readOnly&&reasons.includes('overdue')&&<div className="mc-triage" role="group" aria-label={'Resolver tarea vencida: '+record.title}>
     <label>Reprogramar <input type="date" aria-label={'Nueva fecha para '+record.title} disabled={busy} value={record.date} onChange={e=>{if(e.target.value)onTriage(record,{type:'reschedule',date:e.target.value});}}/></label>
     <button disabled={busy} onClick={()=>onTriage(record,{type:'wait'})}>Esperando respuesta</button><button disabled={busy} onClick={()=>onComplete(record)}>Completar</button><button disabled={busy} onClick={()=>onTriage(record,{type:'cancel'})}>Cancelar / archivar</button>
    </div>}
    {!record.readOnly&&reasons.includes('incomplete')&&<button className="mc-inline-add" disabled={busy} onClick={()=>onComplete(record)}>Resolver cierre incompleto</button>}
   </article>)}</div></details>}
  </div>
  <details className="mc-card mc-small-card mc-health"><summary>Revisión diaria de datos · {today}</summary><p className="mc-muted">Se recalcula al cargar y actualizar los datos. No modifica registros.</p><dl>{Object.entries(report.health).map(([key,count])=><div key={key}><dt>{healthLabels[key as keyof typeof healthLabels]}</dt><dd>{count}</dd></div>)}</dl></details>
 </section>;
}
