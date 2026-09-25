import {it,expect} from 'vitest';
import {attentionReport,completionAction,editorSaveAction} from '@/lib/family-mission/attention';
import {validateRecord} from '@/lib/family-mission/model';
const task={...validateRecord({kind:'task',title:'Original',date:'2026-09-24',checklist:[{text:'Pendiente',done:false}]}),id:'one',revision:1};
it('ignores legacy sub-items for attention and completion choices',()=>{
 expect(attentionReport([{...task,status:'done'}],'2026-09-24').items).toEqual([]);
 expect(completionAction(task,task.date,[task])).toMatchObject({type:'save',record:{status:'done'}});
 expect(editorSaveAction({...task,status:'done'},task.date,[task])).toMatchObject({type:'save',record:{status:'done'}});
});
