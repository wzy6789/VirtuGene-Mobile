import {useEffect,useRef,useState} from 'react';
import {SettingsGroup} from './SettingsUI';
import {clearResourceCache,inspectResourceCache,type ResourceCacheInfo} from '../../lib/resource-cache';

export function CacheSettings() {
 const [info,setInfo]=useState<ResourceCacheInfo>();
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;void inspectResourceCache().then(value=>{if(mounted.current)setInfo(value);});return()=>{mounted.current=false;};},[]);
 const clear=async()=>{
  if(busy)return;
  setBusy(true);setMessage('');
  try {
   const result=await clearResourceCache();
   const text=result.nativeFailed||result.failedCaches?'部分缓存未能清理，可以重试。'
    :result.unavailable?'当前环境暂不支持系统资源缓存清理。'
    :result.nativeRequested?'已发起资源缓存清理，聊天与生活记录已保留。'
    :result.removedCaches?'已清理应用资源缓存，聊天与生活记录已保留。':'当前没有可清理的应用资源缓存。';
   const refreshed=await inspectResourceCache();
   if(mounted.current){setMessage(text);setInfo(refreshed);}
  }catch {if(mounted.current)setMessage('清理未完成，请稍后重试。');}
  finally {if(mounted.current)setBusy(false);}
 };
 return <div className="space-y-5">
  <p className="vg-settings-intro">清理可重新加载的图片、页面等资源缓存。聊天记录、角色记忆、日记、待办、登录信息和声音样本都会保留。</p>
  <SettingsGroup title="资源缓存"><div className="p-4 space-y-3">
   {!message&&<p className="text-sm text-sub">{!info?'正在检查…':info.nativeSupported?'手机资源缓存由系统管理，无法准确统计大小。':info.nativeUnavailable?'此安装包暂不支持系统资源缓存清理。':info.webCacheCount===0?'当前没有可清理的应用资源缓存。':info.webCacheCount!==null?`可清理 ${info.webCacheCount} 组应用资源缓存。`:'当前无法读取资源缓存状态。'}</p>}
   <button type="button" className="vg-button vg-button-secondary" disabled={busy||!info||info.nativeUnavailable||(!info.nativeSupported&&!info.webSupported)} onClick={()=>void clear()}>{busy?'正在清理…':'清理资源缓存'}</button>
   {message&&<p role="status" className="text-sm text-sub">{message}</p>}
  </div></SettingsGroup>
  <p className="text-sm text-sub">清理后，部分图片可能需要重新加载。回复变慢还可能来自历史读取、网络或模型等待，清缓存不能保证缩短这些等待。</p>
 </div>;
}
