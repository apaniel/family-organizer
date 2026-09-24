import {recordChips} from '@/lib/family-mission/attention';
import type {FamilyRecord} from '@/lib/family-mission/model';
export default function RecordChips({record,day,records=[]}:{record:FamilyRecord;day:string;records?:FamilyRecord[]}){
 return <span className="mc-chips" aria-label="Responsable, estado y origen">{recordChips(record,day,records).map(label=><span key={label}>{label}</span>)}</span>;
}
