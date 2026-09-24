import {expect,it,vi} from 'vitest';
import {completionAction,prepareCompletion} from '@/lib/family-mission/attention';
import {dateKey,validateRecord,type FamilyRecord} from '@/lib/family-mission/model';

it.each(['all','partial','keep'] as const)('creates the open daily template before the Hecho dialog and resolves %s',async choice=>{
 const today=dateKey();
 const draft:FamilyRecord={...validateRecord({kind:'task',title:'Mochila',date:today,recurrence:'daily',status:'done',checklist:[{text:'Libro',done:false}]}),id:'',revision:0};
 const staleRecords:FamilyRecord[]=[];
 const template={...draft,id:'new-template',revision:1,status:'open' as const};
 const save=vi.fn(async(value:FamilyRecord)=>{
  expect(value).toMatchObject({id:'',status:'open',recurrence:'daily',checklist:[{done:false}]});
  return template;
 });
 const prepared=await prepareCompletion(draft,today,staleRecords,save);
 expect(save).toHaveBeenCalledTimes(1);
 expect(prepared?.action).toEqual({type:'choose'});
 expect(prepared?.record).toEqual(template);
 expect(staleRecords).toEqual([]); // React has not committed the saved record.
 expect(prepared?.snapshot).toEqual([template]);
 const action=completionAction(prepared!.record,today,[template],choice,prepared!.snapshot);
 if(choice==='keep')expect(action).toEqual({type:'keep'});
 else {
  expect(action).toMatchObject({type:'save',record:{id:'',status:'done',recurrence:'none',date:today,sourceKey:`completion:${template.id}:${today}`,completionDecision:choice,checklist:[{done:choice==='all'}]}});
 }
 expect(template).toMatchObject({status:'open',revision:1,checklist:[{done:false}]});
});
