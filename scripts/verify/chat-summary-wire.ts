import {summarizeContext} from '../../src/lib/ai/context-summarizer';
import {buildSummaryBatch} from '../../src/lib/ai/summary-batches';
import {useAuthStore} from '../../src/store/auth-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {saveProviderConfig} from '../../src/lib/ai/provider-config';
import {setGatewayAccessToken} from '../../src/lib/ai/gateway-session';
declare const SUMMARY_WIRE_UPSTREAM:string;
const api=window as any,nativeFetch=window.fetch.bind(window);
let mode:'direct'|'gateway'='direct';
window.fetch=(input,init)=>String(input).includes('/chat/completions')
  ?nativeFetch(SUMMARY_WIRE_UPSTREAM+'/direct/chat/completions',init):nativeFetch(input,init);
function block(index:number,unicode:boolean){
  const prefix='SYNTHETIC_SEGMENT_'+String(index).padStart(2,'0')+'_',tail='END_SEGMENT_'+String(index).padStart(2,'0')+'_';
  return prefix+'甲'.repeat((unicode?1199:1200)-prefix.length-tail.length)+tail+(unicode?'😀':'');
}
api.summaryWireCases=()=>[
  {name:'twelve-standard-segments',history:buildSummaryBatch(Array.from({length:12},(_,i)=>({id:'standard-'+i,revision:1,content:block(i,false)})),{}).map(segment=>({role:'user',content:segment.content,userAuthored:true})),previousSummary:'上一轮合成记录。',protectedMemories:['用户明确要求保留的合成事实。']},
  {name:'twelve-unicode-boundary-segments',history:buildSummaryBatch([{id:'unicode-long-source',revision:3,content:Array.from({length:12},(_,i)=>block(i,true)).join('')}],{}).map(segment=>({role:'user',content:segment.content,userAuthored:true})),previousSummary:'旧'.repeat(2500),protectedMemories:Array.from({length:8},(_,i)=>String(i)+'保'.repeat(179))},
  {name:'mixed-provenance-segments',history:[{role:'assistant',content:block(21,true),groupMember:true},{role:'user',content:block(22,true),userAuthored:false}],previousSummary:'角色曾说与助理代拟仍需区分。',protectedMemories:[]},
];
api.runSummaryWire=async(selected:'direct'|'gateway')=>{
  mode=selected;useAuthStore.setState({userId:'isolated-summary-wire-owner',apiKey:selected==='direct'?'synthetic-not-a-credential':null});
  saveProviderConfig('deepseek',{enabled:true});useSettingsStore.setState({defaultModel:{provider:'deepseek',model:'deepseek-flash'}});
  setGatewayAccessToken(selected==='gateway'?'synthetic-gateway-token':null);
  const results=[];
  for(const item of api.summaryWireCases()){
    const result=await summarizeContext({apiKey:selected==='direct'?'synthetic-not-a-credential':'',history:item.history,previousSummary:item.previousSummary,protectedMemories:item.protectedMemories});
    results.push({mode,name:item.name,input:item,result});
  }
  return results;
};
api.runInvalidSummaryWire=async(selected:'direct'|'gateway')=>{
  mode=selected;useAuthStore.setState({userId:'isolated-summary-wire-owner',apiKey:selected==='direct'?'synthetic-not-a-credential':null});
  saveProviderConfig('deepseek',{enabled:true});useSettingsStore.setState({defaultModel:{provider:'deepseek',model:'deepseek-flash'}});setGatewayAccessToken(selected==='gateway'?'synthetic-gateway-token':null);
  const cases=[{name:'thirteen-segments',history:Array.from({length:13},(_,i)=>({role:'user',content:'synthetic-'+i}))},
    {name:'overlong-segment',history:[{role:'user',content:'甲'.repeat(1202)}]},
    {name:'extra-non-surrogate-character',history:[{role:'user',content:'甲'.repeat(1201)}]}];
  const results=[];
  for(const item of cases)results.push({mode,...item,result:await summarizeContext({apiKey:selected==='direct'?'synthetic-not-a-credential':'',history:item.history})});
  return results;
};
