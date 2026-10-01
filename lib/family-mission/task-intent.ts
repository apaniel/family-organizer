// A retained key belongs to one submitted payload; a new form is a new intent.
export function taskIntent(pending:{payload:string;key:string}|null,payload:string){return pending?.payload===payload?pending:{payload,key:crypto.randomUUID()};}
