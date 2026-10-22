import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
export async function readDiagnosticData(){
 const {payload}=JSON.parse(readFileSync('release/oppo-diagnostic-backup-encrypted.json','utf8'));
 const password=readFileSync('release/oppo-diagnostic-backup-password.txt','utf8').trim();
 const material=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt:Buffer.from(payload.salt,'base64'),iterations:120000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
 const bytes=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(payload.iv,'base64')},key,Buffer.from(payload.data,'base64'));
 const data=JSON.parse(new TextDecoder().decode(bytes));
 delete data.users; // Account records are unnecessary for isolated performance diagnosis.
 return data;
}
