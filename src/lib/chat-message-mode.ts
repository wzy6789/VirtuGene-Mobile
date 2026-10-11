import {allowsDramaticReply} from './chat-expression-boundary';
import {isLongFormRequest} from './reply-quality';

/** Render the existing delivery decision, rather than leaving the model to
 * infer that claiming a story identity also requests an enacted scene.
 * The caller enables this for the owned character projection only. */
export function buildMessageModeContext(message:string,recentUserMessages:string[],enabled:boolean):string {
  if(!enabled||isLongFormRequest(message)||allowsDramaticReply(message,recentUserMessages))return '';
  return '[本轮对话方式]\n本轮采用文字消息交流。人物身份决定称呼与亲疏，认领身份没有同时要求续写一段见面剧情。\n这次写你现在想对他说的话：自己的心意、看法、好奇和共同设想都可以直接聊。小说旧事和已有生活记录沿原来源使用，不必先给自己安排一个现场或经历才能接话。\n[/本轮对话方式]';
}
