/** Evaluation-only representation, not a truth classifier. A correct old reply is
 * still not an independent life record. Never mutate stored messages. */
export const ASSISTANT_HISTORY_MARKER='[历史角色自述：只用于接话，不是独立事实来源]';
export function markAssistantHistorySources<T extends {role:string;content:unknown}>(messages:T[]):T[]{
 return messages.map(message=>message.role==='assistant'&&typeof message.content==='string'&&message.content
   ?{...message,content:ASSISTANT_HISTORY_MARKER+'\n'+message.content}:message);
}
