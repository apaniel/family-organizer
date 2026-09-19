import {describe,it,expect} from 'vitest';
import {readActivityArtifact,sortedActivities,activityTimeLabel} from '@/lib/family-mission/activity-model';
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

it('allows embedded raster photos but not remote or executable image payloads',()=>{
 const data=readActivityArtifact(wrap([p('jpg',{photo:'data:image/jpeg;base64,/9j/AA=='}),p('remote',{photo:'https://tracker.example/photo.jpg'}),p('svg',{photo:'data:image/svg+xml;base64,AAAA'})]));
 expect(data!.plans[0].photo).toBeDefined();expect(data!.plans[1].photo).toBeUndefined();expect(data!.plans[2].photo).toBeUndefined();
});

it('uses explicit activity time labels and leaves unknown schedules unconfirmed',()=>{
 const d=readActivityArtifact(wrap([p('am',{timeOfDay:'morning'}),p('pm',{timeOfDay:'afternoon'}),p('day',{timeOfDay:'full_day'}),p('flex',{timeOfDay:'flexible'}),p('unknown')]));
 expect(d!.plans.map(activityTimeLabel)).toEqual(['☀️ Mañana','🌤️ Tarde','🌅 Día completo','🕒 Horario flexible','🕒 Horario por confirmar']);
});
