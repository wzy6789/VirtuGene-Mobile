/** Optional receipts are not execution authority. Only a known settled value
 * or legacy absence may participate in a complete reply. */
export interface ReplyDeliveryState {
  role?:string;replyDelivery?:unknown;replyCompletion?:unknown;interrupted?:boolean;stopped?:boolean;
}
export const INCOMPLETE_REPLY_MARKER='[未完成回复片段，不证明已完整回答]\n';
export function hasSettledReplyDelivery(row:ReplyDeliveryState):boolean{
  return row.replyDelivery===undefined||row.replyDelivery==='settled';
}
export function isIncompleteAssistantReply(row:ReplyDeliveryState):boolean{
  return row.role==='assistant'&&(!hasSettledReplyDelivery(row)
    ||(row.replyCompletion!==undefined&&row.replyCompletion!=='complete')||row.interrupted===true||row.stopped===true);
}
/** Restoring bytes never resumes a transport or upgrades a partial answer. */
export function normalizeImportedReplyDelivery<T extends ReplyDeliveryState>(row:T):T{
  return row.role==='assistant'&&!hasSettledReplyDelivery(row)
    ?{...row,replyDelivery:'settled',replyCompletion:'interrupted',interrupted:true,stopped:true}:row;
}
