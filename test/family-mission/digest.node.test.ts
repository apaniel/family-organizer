import {describe,it,expect} from 'vitest';
import {validateDigest,documentType,validDigestDate} from '@/lib/family-mission/digest-model';
describe('daily digest',()=>{
 const receipt={kind:'receipt',date:'2026-09-17',title:'Compra',sourceKey:'gmail:x:receipt',amountMinor:1999,currency:'EUR'};
 it('keeps exact money and receipts pending even if an input claims a match',()=>{const r=validateDigest({...receipt,receiptState:'matched',transactionId:'invented'});expect(r.amountMinor).toBe(1999);expect(r.receiptState).toBe('pending');expect(r).not.toHaveProperty('transactionId');});
 it('rejects invalid dates, decimal money, missing currency and missing provenance',()=>{expect(validDigestDate('2026-02-30')).toBe(false);for(const patch of [{date:'2026-02-30'},{amountMinor:1.99},{currency:''},{sourceKey:''}])expect(()=>validateDigest({...receipt,...patch})).toThrow();});
 it('does not invent an amount for an unpriced receipt',()=>expect(validateDigest({...receipt,amountMinor:null,currency:''}).amountMinor).toBeNull());
 it('accepts PDFs and rejects executable or oversized attachments',()=>{expect(documentType(new TextEncoder().encode('%PDF-1.4 test'))).toBe('application/pdf');expect(()=>documentType(new TextEncoder().encode('<html>evil'))).toThrow();expect(()=>documentType(new Uint8Array(5*1024*1024+1))).toThrow();});
});
