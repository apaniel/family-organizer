import {expect,it,vi} from 'vitest';
import {prepareCompletion} from '@/lib/family-mission/attention';
import {dateKey,validateRecord,type FamilyRecord} from '@/lib/family-mission/model';
it('creates the open daily template and immediately completes its occurrence',async()=>{
 const today=dateKey();
 const draft:FamilyRecord={...validateRecord({kind:'task',title:'Mochila',date:today,recurrence:'daily',status:'done'}),id:'',revision:0};
 const template={...draft,id:'new-template',revision:1,status:'open' as const};
 const save=vi.fn(async(value:FamilyRecord)=>{expect(value).toMatchObject({id:'',status:'open',recurrence:'daily',checklist:[]});return template;});
 const prepared=await prepareCompletion(draft,today,[],save);
 expect(save).toHaveBeenCalledTimes(1);
 expect(prepared?.action).toMatchObject({type:'save',record:{id:'',status:'done',recurrence:'none',date:today,sourceKey:`completion:${template.id}:${today}`,checklist:[]}});
 expect(template).toMatchObject({status:'open',revision:1});
});
