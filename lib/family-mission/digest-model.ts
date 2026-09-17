export type DigestItem={id:string;revision:number;kind:'delivery'|'receipt'|'event';date:string;title:string;details:string;source:string;sourceKey:string;merchant:string;amountMinor:number|null;currency:string;orderRef:string;status:string;receiptState:'pending';financeReceiptId?:string;financeStatus?:string;financeTransactionId?:string;documents?:{id:string;filename:string;mime:string}[]};
export function validDigestDate(v:unknown):v is string{return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;}
export function validateDigest(raw:any){
 const text=(v:unknown,n:number)=>typeof v==='string'?v.trim().slice(0,n):'';
 if(!raw||!['delivery','receipt','event'].includes(raw.kind)||!validDigestDate(raw.date))throw new Error('Tipo o fecha no válidos.');
 if(!text(raw.title,200)||!text(raw.sourceKey,250))throw new Error('Título y referencia de origen obligatorios.');
 const amount=raw.amountMinor==null?null:raw.amountMinor;
 if(amount!==null&&(!Number.isSafeInteger(amount)||amount<0||amount>1e12))throw new Error('Importe no válido. Usa céntimos enteros.');
 const currency=text(raw.currency,3).toUpperCase();if(currency&&!/^[A-Z]{3}$/.test(currency)||amount!==null&&!currency)throw new Error('Moneda obligatoria para un importe.');
 return {kind:raw.kind,date:raw.date,title:text(raw.title,200),details:text(raw.details,4000),source:text(raw.source,300),sourceKey:text(raw.sourceKey,250),merchant:text(raw.merchant,160),amountMinor:amount,currency,orderRef:text(raw.orderRef,160),status:text(raw.status,80),receiptState:'pending' as const,financeReceiptId:text(raw.financeReceiptId,80),financeStatus:['pending','matched','review'].includes(raw.financeStatus)?raw.financeStatus:'pending',financeTransactionId:text(raw.financeTransactionId,100)};
}
export function documentType(bytes:Uint8Array){
 if(bytes.length>5*1024*1024||bytes.length<4)throw new Error('Archivo no válido o mayor de 5 MB.');
 if(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-')return 'application/pdf';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')return 'image/png';
 throw new Error('Solo se admiten PDF, JPEG o PNG.');
}
