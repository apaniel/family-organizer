import {it,expect,vi} from 'vitest';
import {commandPayload} from '@/lib/family-mission/tasks-command';
vi.mock('server-only',()=>({}));
const draft={kind:'task',title:'Task',notes:'',owner:'Familia',status:'open'};
it('normalizes the unassigned owner and strips unknown fields',()=>{expect(commandPayload('save',{...draft,owner:'',unknown:'ignored'})).toEqual({action:'save',record:{...draft,owner:'Sin asignar'}});});
it.each([{recurrence:'daily'},{checklist:[{text:'x'}]},{status:'cancelled'},{completeOn:'2026-10-01'},{title:''},{owner:'Unknown'},{date:'bad'},{time:'25:00'},{sourceKey:42},{id:'existing'}])('rejects unsupported task input %j',patch=>{expect(()=>commandPayload('save',{...draft,...patch})).toThrow();});
it('requires a revision for deletion',()=>{expect(()=>commandPayload('delete',{id:'existing'})).toThrow();expect(commandPayload('delete',{id:'existing',revision:10})).toEqual({action:'delete',record:{id:'existing',revision:10}});});
it('rejects invalid operations and IDs',()=>{expect(()=>commandPayload('claim',draft)).toThrow();expect(()=>commandPayload('save',{...draft,id:42})).toThrow();expect(()=>commandPayload('save',null)).toThrow();});
