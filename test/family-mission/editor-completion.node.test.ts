import {it,expect} from 'vitest';
import {editorSaveAction} from '@/lib/family-mission/attention';
import {validateRecord,type FamilyRecord} from '@/lib/family-mission/model';

it.each([false,true].flatMap(existing=>[undefined,'all','partial','keep'].map(choice=>({existing,choice:choice as 'all'|'partial'|'keep'|undefined}))))('submits a daily task on its changed date (existing: $existing, choice: $choice)',({existing,choice})=>{
 const original:FamilyRecord={...validateRecord({kind:'task',title:'Mochila',date:'2026-09-24'}),id:'original',revision:3};
 const records=existing?[original]:[];
 const draft:FamilyRecord={...original,id:existing?original.id:'',revision:existing?3:0,date:'2026-09-25',recurrence:'daily',status:'done',checklist:choice?[{text:'Libro',done:false}]:[]};
 const before=structuredClone({draft,records});
 const initial=editorSaveAction(draft,'2026-09-24',records);
 if(choice){
  expect(initial).toEqual({type:'choose'}); // No write before a decision.
  const resolved=editorSaveAction(draft,'2026-09-24',records,choice,structuredClone(records));
  if(choice==='keep')expect(resolved).toEqual({type:'keep'}); // Editor stays open; no write.
  else expect(resolved).toMatchObject({type:'save',record:{id:draft.id,revision:draft.revision,date:'2026-09-25',status:'done',completeOn:'2026-09-25',completeChoice:choice,completionDecision:choice==='partial'?'partial':undefined}});
 }else expect(initial).toMatchObject({type:'save',record:{date:'2026-09-25',status:'done',completeOn:'2026-09-25'}});
 expect({draft,records}).toEqual(before);
});
