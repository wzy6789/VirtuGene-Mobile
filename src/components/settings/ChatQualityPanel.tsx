import { useEffect, useRef, useState } from 'react';
import { db, type Character } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { Modal } from '../ui/Modal';
import { chatQualityReport, clearChatQuality } from '../../lib/chat-quality-metrics';
import { voiceCacheStatus, refreshVoiceSamples } from '../../lib/chat/voice-sample-cache';
import { EVALUATION_PERSONAS, evaluationSummary, runExpressionEvaluation, type EvaluationReport } from '../../lib/chat-expression-evaluation';
import { SettingsGroup } from './SettingsUI';
import { DIALOGUE_TRAJECTORIES } from '../../lib/chat-evaluation-trajectories';

function download(value:unknown,name:string) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function ChatQualityPanel({open,onClose}:{open:boolean;onClose:()=>void}) {
  const owner=useAuthStore(s=>s.userId),apiKey=useAuthStore(s=>s.apiKey) ?? '';
  const [version,update]=useState(0),[characters,setCharacters]=useState<Character[]>([]),[selected,setSelected]=useState('');
  const [evaluation,setEvaluation]=useState<{owner:string;report:EvaluationReport}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [trajectory,setTrajectory]=useState(DIALOGUE_TRAJECTORIES[0].id);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>{const refresh=()=>update(v=>v+1);window.addEventListener('vg:chat-quality',refresh);return()=>window.removeEventListener('vg:chat-quality',refresh);},[]);
  useEffect(()=>{let cancelled=false;if(open&&owner) void db.characters.where('createdBy').equals(owner).toArray().then(rows=>{if(!cancelled&&useAuthStore.getState().userId===owner){const roles=rows.filter(c=>!c.isPreset&&c.agentProfile!=='secretary');setCharacters(roles);setSelected(id=>roles.some(c=>c.id===id)?id:roles[0]?.id ?? '');}});return()=>{cancelled=true;};},[open,owner,version]);
  useEffect(()=>{controller.current?.abort();controller.current=null;setEvaluation(null);setBusy(false);setError('');return()=>controller.current?.abort();},[owner,open]);
  const rows=characters.filter(c=>c.createdBy===owner),report=chatQualityReport(), active=evaluation?.owner===owner?evaluation.report:null;
  const start=async(kind:'single'|'matrix'|'long'|'small')=>{
    const role=rows.find(c=>c.id===selected);if(!role||!owner||controller.current) return;
    const task=new AbortController();controller.current=task;setBusy(true);setError('');setEvaluation(null);
    const cases=kind==='matrix'?EVALUATION_PERSONAS.map((p,i)=>({...role,id:`evaluation-${i}`,name:p.name,systemPrompt:p.prompt,tags:[],voiceSamples:undefined,catchphrase:undefined})): [role];
    try {const result=await runExpressionEvaluation(cases,kind==='long'?30:15,task.signal,r=>{if(!task.signal.aborted&&useAuthStore.getState().userId===owner)setEvaluation({owner,report:r});},kind==='small'?{trajectoryId:trajectory}:undefined);
      if(!task.signal.aborted&&useAuthStore.getState().userId===owner)setEvaluation({owner,report:result});
    } catch {if(!task.signal.aborted&&useAuthStore.getState().userId===owner)setError('验收未完成，请检查模型连接。');}
    finally {if(controller.current===task){controller.current=null;setBusy(false);}}
  };
  const rating=(index:number,key:'naturalness'|'identity'|'context'|'truth',value:number)=>{
    if(!active||!owner)return;const next={...active,rows:active.rows.map((row,i)=>i===index?{...row,ratings:{...(row.ratings ?? {naturalness:0,identity:0,context:0,truth:0}),[key]:value}}:row)};setEvaluation({owner,report:next});
  };
  return <Modal open={open} onClose={()=>{controller.current?.abort();onClose();}} title="聊天质量" panelClassName="vg-settings-panel" canSnapshotOnExit={()=>false}><div className="vg-settings-design space-y-5">
    <p className="vg-settings-intro">统计只保存在本机，不包含聊天原文。最近最多保留 200 条检查记录；重试率低不等于更像真人。</p>
    <SettingsGroup title="按聊天入口查看">{(['private','proactive','group'] as const).map((mode,i)=>{const m=report.byMode[mode];return <div key={mode} className="p-4 border-b border-line"><strong>{['私聊','主动消息','群聊'][i]}</strong><p className="text-sm text-sub mt-2">检查 {m.checked} · 重试 {m.retried} · 仍有问题 {m.unresolved} · 拦截 {m.blocked}</p><p className="text-sm text-sub">重试后通过 {m.improvedAfterRetry} · 已上屏问题 {m.streamedUnresolved}{m.averageDurationMs!==null?` · 平均处理 ${Math.round(m.averageDurationMs)}ms`:''}</p>{m.averageFirstVisibleMs!==null&&<p className="text-sm text-sub">平均首次显示 {Math.round(m.averageFirstVisibleMs)}ms</p>}</div>;})}</SettingsGroup>
    <SettingsGroup title="私聊呈现处理"><p className="p-4 text-sm text-sub">已测量 {report.measuredTurns} 轮 · 平均文字差异 {report.averageDifference===null?'暂无数据':`${(report.averageDifference*100).toFixed(1)}%`} · 差异超过 15% 的记录 {report.alerts} 条。空白与分条标记不计入文字差异；原文不保存。</p></SettingsGroup>
    <div className="flex gap-3"><button type="button" className="min-h-12 flex-1 rounded-xl border border-line" onClick={()=>download(report,'chat-quality-statistics.json')}>导出统计</button><button type="button" className="min-h-12 flex-1 rounded-xl border border-line" onClick={clearChatQuality}>清空统计</button></div>
    <SettingsGroup title="角色声音样本"><p className="p-4 text-sm text-sub">有有效样本 {rows.filter(c=>['authored','cached'].includes(voiceCacheStatus(c))).length} / {rows.length}。补全会调用当前任务模型，不改写人设。</p>{rows.map(c=><div key={c.id} className="p-4 flex items-center justify-between gap-3"><span>{c.name}<small className="block text-sub">{{authored:'已有手写样本',cached:'缓存有效',pending:'正在补全',failed:'上次补全失败',missing:'尚未补全'}[voiceCacheStatus(c)]}</small></span>{!['authored','cached'].includes(voiceCacheStatus(c))&&<button type="button" className="min-h-12 px-3 rounded-xl border border-line" disabled={voiceCacheStatus(c)==='pending'} onClick={()=>{void refreshVoiceSamples(owner!,c.id,apiKey,{manual:true}).then(()=>update(v=>v+1));update(v=>v+1);}}>补全样本</button>}</div>)}</SettingsGroup>
    <details><summary className="min-h-12 cursor-pointer">真实模型对照验收</summary><div className="space-y-3 pt-3">
      <p className="text-sm text-sub">仅在你点击后调用模型，可能消耗额度。测试使用固定场景，不读取私人记忆，也不写入聊天。结果仅留在当前页面；自动检查不代替人工评分。</p>
      <select aria-label="验收角色" value={selected} onChange={e=>setSelected(e.target.value)} className="w-full min-h-12 rounded-xl bg-surface px-3">{rows.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <p className="text-sm text-sub">建议先做连续小测：V4.1 Flash，最多 6 次调用，每次输出上限 320 token，保留默认思考模式。输入和思考也会消耗额度；无额外裁判调用或自动重试。这是文本表达测试，不验证私人记忆或实际办事。</p>
      <select aria-label="连续对话场景" value={trajectory} onChange={e=>setTrajectory(e.target.value)} className="w-full min-h-12 rounded-xl bg-surface px-3">{DIALOGUE_TRAJECTORIES.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select>
      <button type="button" className="min-h-12 w-full rounded-xl border border-line" disabled={busy||!selected} onClick={()=>void start('small')}>V4.1 Flash · 连续 6 轮小测</button>
      <div className="grid gap-2">{([['single','当前角色 · 15 场景'],['matrix','五种表达风格 · 75 次'],['long','当前角色 · 连续 30 轮']] as const).map(([kind,label])=><button type="button" className="min-h-12 rounded-xl border border-line" key={kind} disabled={busy||!selected} onClick={()=>void start(kind)}>{label}</button>)}</div>
      {busy&&<button type="button" className="min-h-12 w-full rounded-xl border border-line" onClick={()=>controller.current?.abort()}>停止验收</button>}
      {error&&<p role="alert">{error}</p>}
      {active&&<><p role="status">已生成 {active.rows.length} 条 · {active.complete?'生成结束':'未完成'} · 人工已评分 {evaluationSummary(active).rated} 条</p><p className="text-sm text-sub">已报告用量：输入 {evaluationSummary(active).usage.inputTokens} / 输出 {evaluationSummary(active).usage.outputTokens} token；{evaluationSummary(active).usage.unknownCalls} 次用量未知，未知部分未计入。</p><button type="button" className="min-h-12 w-full rounded-xl border border-line" onClick={()=>download({...active,summary:evaluationSummary(active)},'chat-expression-evaluation.json')}>导出测试原文与评分</button>{active.rows.map((row,index)=><details key={index}><summary className="min-h-12">{row.role} · {index+1} · {row.issue??row.error??'本地检查通过'}</summary><p className="text-sub">{row.input}</p>{row.focus&&<p className="text-sm text-sub">观察：{row.focus}</p>}<p className="my-3 whitespace-pre-wrap break-words">{row.reply}</p>{(['naturalness','identity','context','truth'] as const).map((key,i)=><label key={key} className="flex justify-between items-center gap-3 py-2">{['自然度','人物辨识度','情境贴合','事实可靠'][i]}<select aria-label={`${index+1} ${key}`} value={row.ratings?.[key]??0} onChange={e=>rating(index,key,Number(e.target.value))} className="min-h-12 bg-surface px-3"><option value={0}>未评分</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></label>)}</details>)}</>}
    </div></details>
  </div></Modal>;
}
