import {it,expect} from 'vitest';
import {editorSaveAction} from '@/lib/family-mission/attention';
import {validateRecord,type FamilyRecord} from '@/lib/family-mission/model';
it.each([false,true])('submits a binary daily task on its changed date (existing: %s)',existing=>{
 const original:FamilyRecord={...validateRecord({kind:'task',title:'Mochila',date:'2026-09-24'}),id:'original',revision:3};
 const records=existing?[original]:[];
 const draft:FamilyRecord={...original,id:existing?original.id:'',revision:existing?3:0,date:'2026-09-25',recurrence:'daily',status:'done'};
 const before=structuredClone({draft,records});
 expect(editorSaveAction(draft,'2026-09-24',records)).toMatchObject({type:'save',record:{date:'2026-09-25',status:'done',completeOn:'2026-09-25',checklist:[]}});
 expect({draft,records}).toEqual(before);
});
it('completes an existing recurring editor draft as an occurrence, preserving its template',()=>{
 const original:FamilyRecord={...validateRecord({kind:'task',title:'Diaria',date:'2026-09-24',recurrence:'daily'}),id:'series',revision:2};
 expect(editorSaveAction({...original,status:'done'},'2026-09-25',[original])).toMatchObject({type:'save',record:{id:'',recurrence:'none',date:'2026-09-25',status:'done',sourceKey:'completion:series:2026-09-25',completionParent:{id:'series',revision:2}}});
});
