import {GU_YUE_NA_CANON} from '../../src/lib/gu-yue-na-canon';
import type {FactAuditSource} from '../../src/lib/chat-fact-audit';
/** Fixed evaluation source set, not production source retrieval. */
export function guHistoryAuditSources(userMessage:string):FactAuditSource[]{return [
 {id:'relationship',text:'古月娜与唐舞麟已婚，蓝轩宇是孩子；本轮用户直接认领唐舞麟。',scope:'background',independent:true},
 {id:'user-current',text:userMessage,scope:'current',independent:true},
 ...GU_YUE_NA_CANON.map((row,index)=>({id:'canon-'+index,text:row.knowledge,scope:'past' as const,independent:true})),
];}
