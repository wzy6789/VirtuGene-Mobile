import {parseFactAudit,type FactAuditInput,type FactAuditSource} from './chat-fact-audit';
export interface HistoryReviewSnapshot {input:FactAuditInput;raw:string;persona:string}
export interface HistoryReviewMessage {role:string;content:unknown}
/** Evaluation-stage isolation of one reviewed utterance, not a truth engine.
 * Bind the complete user/reply pair, persona and independent source snapshot.
 * Isolate a whole affected historical bubble so dependent sentences do not
 * keep an unsupported antecedent alive. Never delete stored history or
 * interpret unsupported as proven false. */
export function quarantineReviewedHistory<T extends HistoryReviewMessage>(messages:T[],snapshot:HistoryReviewSnapshot,persona:string,sources:FactAuditSource[]):{messages:T[];quotes:string[];applied:boolean}{
 const unchanged={messages,quotes:[],applied:false};
 if(persona!==snapshot.persona||JSON.stringify(sources)!==JSON.stringify(snapshot.input.sources))return unchanged;
 const audit=parseFactAudit(snapshot.raw,snapshot.input);
 if(audit.invalid||audit.verdict!=='revise')return unchanged;
 const quotes=[...new Set(audit.claims.filter(claim=>!claim.supported).map(claim=>claim.quote))];
 if(!quotes.length)return unchanged;
 const candidates=messages.flatMap((message,index)=>message.role==='assistant'&&message.content===snapshot.input.candidate
   &&messages[index-1]?.role==='user'&&messages[index-1].content===snapshot.input.userMessage?[index]:[]);
 if(candidates.length!==1)return unchanged;
 const position=candidates[0],old=messages[position];
 const parts=snapshot.input.candidate.split(/\s*-{3,}\s*/u).filter(bubble=>!bubble.split(/(?<=[。！？!?])|\r?\n/u)
   .some(sentence=>quotes.includes(sentence.trim()))).map(bubble=>bubble.trim()).filter(Boolean);
 const content=parts.join('\n---\n');
 if(content===old.content)return unchanged;
 const result=messages.slice();
 if(content)result[position]={...old,content};else result.splice(position,1);
 return {messages:result,quotes,applied:true};
}
