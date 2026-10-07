import type { ChatSituation } from './chat-expression-guidance';

const requests = [
  '帮我看看这个报告','那个报告你帮我看看呗','明天的安排请你帮我整理一下','这段话你帮我改改',
  '请你解释一下这个词','给我推荐一本书','替我想一个名字','请帮我分析这件事','帮我写段开场白','能帮我读读这段话吗',
  '你帮我查一下这个问题','帮我设计一个方案','请你帮我制定计划','帮我看看哪个更合适','给我写一个例子',
  '教我怎么表达这句话','告诉我这是什么意思','整理一下这些材料','解释一下这句话','分析一下原因',
  '推荐一个思路','设计一个简单流程','制定明天的计划','写一个简短故事','写段自然的问候',
  '帮我想想怎么拒绝','请你帮我看下错别字','帮我改一下标题','给我说一个具体例子','替我看看这个安排',
];
const emotions:Array<[string,ChatSituation]> = [
  ['我好委屈','distress'],['我今天很难过','distress'],['我失恋了','distress'],['我想哭','distress'],['我很担心','distress'],
  ['我好生气','distress'],['我很焦虑','distress'],['我觉得孤单','distress'],['我有点失望','distress'],['我开心不起来','distress'],
  ['我好累','tired'],['我累死了','tired'],['我没精神','tired'],['我疲惫得不想动','tired'],['我精疲力尽','tired'],
  ['我好开心','celebration'],['我很高兴','celebration'],['我特别兴奋','celebration'],['我终于做完了','celebration'],['我很开心，但我好累','mixed'],
];
export interface ExpressionCorpusCase {text:string;request:boolean;situation?:ChatSituation}
/** Fixed Chinese utterances plus explicit quote/negation/third-person contrasts. */
export const EXPRESSION_SIGNAL_CORPUS:ExpressionCorpusCase[] = [
  ...requests.flatMap(text=>[{text,request:true},{text:`他说“${text}”`,request:false,situation:'neutral' as const},{text:`不用${text}`,request:false}]),
  ...emotions.flatMap(([text,situation])=>[{text,request:false,situation},{text:`她说“${text}”`,request:false,situation:'neutral' as const},{text:text.replace(/我/gu,'她'),request:false,situation:'neutral' as const}]),
];
