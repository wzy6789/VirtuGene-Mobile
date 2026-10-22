import './chat-continuity-resume';
import {db} from '../../src/db';
import {PRESET_CHARACTERS} from '../../src/lib/seed-init';
import {reviseOriginalPresetVoice,reviseOriginalPresetCard} from '../../src/lib/original-preset-voice';
import {reviseGuYueNaPresetPrompt} from '../../src/lib/gu-yue-na-personality';
import {withDouluoRelations} from '../../src/lib/douluo-relations';
import {useChatStore} from '../../src/store/chat-store';
import {useSettingsStore} from '../../src/store/settings-store';

const api=window as any;
api.runCurrentStreamLatency=async()=>{
  const samples=[];
  for(const name of ['林舟','古月娜','陆雪琪']){
    await api.prepareResumeReload();
    const prior=(await db.characters.get('resume-actor'))!;
    const preset=PRESET_CHARACTERS.find(character=>character.name===name);
    const character=preset?{...prior,...preset,...reviseOriginalPresetCard(preset,preset.id),
      id:prior.id,createdBy:prior.createdBy,isPreset:false,isCustom:true,sourcePresetId:preset.id,proactivity:0,
      systemPrompt:name==='古月娜'?withDouluoRelations(reviseGuYueNaPresetPrompt(preset.systemPrompt),preset.id):reviseOriginalPresetVoice(preset.systemPrompt,preset.id)}:
      {...prior,name,sourcePresetId:undefined,systemPrompt:'你是成年朋友林舟，说话自然，直接聊当下。',tags:['自然'],proactivity:0};
    await db.characters.put(character);
    useChatStore.setState({characters:[character]});
    useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false,chatThinkingEnabled:true,defaultModel:{provider:'deepseek',model:'deepseek-flash'}});
    const started=performance.now(),sample:any={name,mainCalls:0,auxiliaryCalls:0,events:[]};
    api.__latencyPublication=()=>{sample.firstPublicationMs??=performance.now()-started;};
    window.fetch=async(_url,init)=>{
      const body=JSON.parse(String(init?.body));
      if(body.stream!==true){sample.auxiliaryCalls++;return Response.json({choices:[{message:{content:'[]'},finish_reason:'stop'}]});}
      sample.mainCalls++;sample.requestAtMs=performance.now()-started;
      sample.generation={model:body.model,thinking:body.thinking,reasoning_effort:body.reasoning_effort,stream:body.stream};
      const encoder=new TextEncoder();
      const response=new ReadableStream<Uint8Array>({start(controller){
        setTimeout(()=>{
          sample.firstBodyMs=performance.now()-started;
          controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:'嗯，选对了。'}}]})+'\n\n'));
        },200);
        setTimeout(()=>{
          sample.completeBodyMs=performance.now()-started;
          controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:'---这顿不错。'}}]})+'\n\n'));
          controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));
          controller.close();
        },1400);
      }});
      return new Response(response,{headers:{'Content-Type':'text/event-stream'}});
    };
    const result=await api.resumeTestTurn('今天食堂的面不错，想跟你聊两句。');
    sample.completeMs=performance.now()-started;sample.failed=result.result.failed;sample.error=result.result.error;
    sample.replies=result.result.replies.map((row:any)=>row.content);
    sample.bodyToPublicationMs=sample.firstPublicationMs-sample.firstBodyMs;
    delete api.__latencyPublication;samples.push(sample);
  }
  return {samples,paidCalls:0,scope:'Current native sender/SSE reader/ChatReplyStream callback with controlled first chunk at200ms and completion at1400ms. Role-specific persona varies; this is an output-gate demonstration, not a causal model-quality comparison or DOM/Android rendering measurement.'};
};
