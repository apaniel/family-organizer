'use client';
import {attentionLabels,attentionReport,attentionContext,attentionReasonCopy,attentionSummary,attentionQuickActions,attentionTomorrow,canTriageOverdue,type TriageAction} from '@/lib/family-mission/attention';
import type {FamilyRecord} from '@/lib/family-mission/model';

export default function AttentionCentre({records,today,onOpen,busy,onTriage,onComplete,onConfirm}:{records:FamilyRecord[];today:string;onOpen:(record:FamilyRecord)=>void;busy:boolean;onTriage:(record:FamilyRecord,action:TriageAction)=>void;onComplete:(record:FamilyRecord)=>void;onConfirm:(record:FamilyRecord)=>void}){
 const report=attentionReport(records,today);
 const healthLabels={overdue:'Tareas vencidas',waiting:'Tareas esperando respuesta',unconfirmed:'Elementos sin confirmar',stale:'Tareas vencidas hace 7 días o más',unassigned:'Elementos sin responsable',approaching:'Planes sin confirmar en los próximos 7 días'};
 const renderItem=({record,reasons}: typeof report.items[number])=><article className="mc-attention-row" key={record.id}>
    <button className="mc-attention-title" onClick={()=>onOpen(record)}><strong>{record.title}</strong></button>
    <p className="mc-attention-context">{attentionContext(record,today)}</p>
    <p className="mc-attention-reason">{attentionReasonCopy(reasons)}</p>
    <div className="mc-attention-actions" role="group" aria-label={'Acciones para '+record.title}>
     {attentionQuickActions(record,reasons).map(action=><button key={action.type} disabled={busy} onClick={()=>{
      if(action.type==='complete')onComplete(record);
      else if(action.type==='tomorrow')onTriage(record,attentionTomorrow(today));
      else if(action.type==='confirm')onConfirm(record);
      else if(action.type==='assign')onOpen(record);
      else onTriage(record,{type:action.type});
     }}>{action.label}</button>)}
    </div>
    {canTriageOverdue(record,reasons)&&<details className="mc-attention-more"><summary>Más opciones<span className="sr-only"> para {record.title}</span></summary><form className="mc-triage" key={record.revision} onSubmit={e=>{e.preventDefault();if(busy)return;const date=String(new FormData(e.currentTarget).get('date')||'');if(date)onTriage(record,{type:'reschedule',date});}}>
     <label>Elegir otra fecha <input type="date" aria-label={'Nueva fecha para '+record.title} name="date" required disabled={busy} defaultValue={record.date}/></label>
     <button type="submit" disabled={busy}>Cambiar fecha</button>
     <button type="button" className="mc-attention-archive" disabled={busy} onClick={()=>onTriage(record,{type:'cancel'})}>Archivar</button>
    </form></details>}
   </article>;
 return <section className="mc-attention" aria-label="Necesita atención">
  <div className="mc-section-heading"><h2>Necesita atención</h2></div>
  <div className="mc-card mc-small-card">
   <p className="mc-attention-summary">{attentionSummary(report.items.length)}</p>
   <p className="mc-muted">{Object.entries(report.counts).filter(([,count])=>count>0).map(([reason,count])=>`${attentionLabels[reason as keyof typeof attentionLabels]}: ${count}`).join(' · ')}</p>
   {!report.items.length?<p className="mc-muted">No hay asuntos que necesiten atención en los datos cargados.</p>:<><div className="mc-attention-list">{report.items.slice(0,4).map(renderItem)}</div>{report.items.length>4&&<details className="mc-attention-remainder"><summary>Ver {report.items.length-4} más</summary><div className="mc-attention-list">{report.items.slice(4).map(renderItem)}</div></details>}</>}
  </div>
  <details className="mc-card mc-small-card mc-health"><summary>Revisión diaria de datos · {today}</summary><p className="mc-muted">Se recalcula al cargar y actualizar los datos. No modifica registros.</p><dl>{Object.entries(report.health).map(([key,count])=><div key={key}><dt>{healthLabels[key as keyof typeof healthLabels]}</dt><dd>{count}</dd></div>)}</dl></details>
 </section>;
}
