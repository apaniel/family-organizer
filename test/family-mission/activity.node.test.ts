import {describe,it,expect} from 'vitest';
import {readActivityArtifact,sortedActivities} from '@/lib/family-mission/activity-model';
const wrap=(plans:any[])=>'<script id="family-activity-data" type="application/json">'+JSON.stringify({version:1,checkedAt:'2026-09-19',plans})+'</script>';
const p=(id:string,patch:any={})=>({id,title:id,url:'https://example.org/activity',...patch});
describe('activity proposals',()=>{
 it('orders by booking or ending deadline, hides expired events, keeps flexible last',()=>{
 const data=readActivityArtifact(wrap([p('flex'),p('expired',{deadline:'2026-09-18'}),p('last-day',{deadline:'2026-09-27'}),p('book',{bookingDeadline:'2026-09-22',deadline:'2026-10-03'})]));
 expect(sortedActivities(data!.plans,'2026-09-19').map(x=>x.id)).toEqual(['book','last-day','flex']);
 });
 it('rejects unsafe sources and malformed data',()=>{expect(readActivityArtifact(wrap([p('bad',{url:'javascript:alert(1)'})]))).toBeNull();expect(readActivityArtifact('old HTML without data')).toBeNull();});
 it('preserves measured distances and treats absent distance as unknown',()=>{const d=readActivityArtifact(wrap([p('near',{distanceKm:4.2}),p('unknown')]));expect(d!.plans.map(x=>x.distanceKm)).toEqual([4.2,null]);});
});
