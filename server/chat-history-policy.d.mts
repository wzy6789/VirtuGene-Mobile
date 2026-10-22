export const HISTORY_TOTAL_CHARS:number;
export const HISTORY_ITEM_CHARS:number;
export const HISTORY_MAX_ITEMS:number;
export const HISTORY_USER_TURNS:number;
export function clipHistoryText(text:string,limit?:number):{text:string;ranges:Array<{start:number;end:number;outputStart:number;outputEnd:number}>};
export function boundChatHistory<T extends {content:string;role?:string}>(history:T[]):T[];
