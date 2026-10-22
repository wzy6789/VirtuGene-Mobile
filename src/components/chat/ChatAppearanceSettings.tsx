import { useEffect, useMemo, useRef, useState } from 'react';
import { db, type Character } from '../../db';
import { liveQuery } from 'dexie';
import { CHAT_ATMOSPHERE_THEMES, getChatAtmosphereTheme } from '../../lib/chat-atmosphere';
import { DEFAULT_CHAT_BACKGROUND, DEFAULT_GLOBAL_BACKGROUND, chatBackgroundError, normalizeChatBackground, resolveChatBackground, type ChatBackgroundConfig, type GlobalChatBackground } from '../../lib/chat-background-config';
import { normalizeBackgroundImage, renderBackgroundImage } from '../../lib/chat-background-image';
import { chatBackgroundRepo, type BackgroundAsset } from '../../db/chat-background-repo';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useChatBackgroundStore, ensureChatBackground, readBackgroundRows, publishBackground, forgetRoleBackground } from '../../store/chat-background-store';
import { SettingsChoices, SettingsGroup, SettingsRow } from '../settings/SettingsUI';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { useChatAtmosphere } from './useChatAtmosphere';
import { CharacterStylePreview } from '../character/CharacterStylePreview';
import { getChatBackgroundEffectProfile } from '../../lib/chat-background-effects';
import { Suspense } from 'react';
import { lazyFeature } from '../ui/lazyFeature';
const StyleWorkspace=lazyFeature(()=>import('../character/CharacterStyleWorkspace').then(m=>({default:m.CharacterStyleWorkspace})));
import { ORB_COLORS } from '../../lib/orb-colors';
import { Avatar } from '../ui/Avatar';
import { cropStyleAvatar, prepareStyleAvatar } from '../../lib/style-avatar';
import { DEFAULT_SCENE_PREFERENCES } from '../../lib/chat-scene/scene-registry';
import { getSceneDescription } from '../../lib/chat-scene/scene-catalog';
import { SceneChoices } from './scene/SceneChoices';
import {AppearanceExperienceControls} from './AppearanceExperienceControls';
import {resolveEffectiveSceneAppearance} from '../../lib/chat-scene/scene-time';
import {GlassSurface} from '../ui/GlassSurface';

type ImageDraft = { source:Blob; display:Blob; width:number; height:number; blur:number; id?:string };
const choices=CHAT_ATMOSPHERE_THEMES.filter(t=>t.id!=='neutral');
export function ChatAppearanceSettings({character}:{character?:Character}) {
  const userId=useAuthStore(s=>s.userId)??'',session=useChatStore(s=>s.currentSessionId),[open,setOpen]=useState(false);
  const atmosphere=useChatAtmosphere(character,userId);
  const [styleTarget,setStyleTarget]=useState<string>();
  return <><SettingsRow title="聊天外观" detail={character?`${atmosphere.config.mode==='scene'?getSceneDescription(atmosphere.config.scene?.id).label:getChatAtmosphereTheme(atmosphere.primary).label} · ${atmosphere.independent?'此角色单独设置':'跟随全局'}`:'纯净、氛围、本地图片与沉浸场景'} icon="appearance" onClick={()=>setOpen(true)}/>
    {character&&<SettingsRow title="角色造型间" detail="头像、主题与小球，一起预览后保存" icon="appearance" onClick={()=>setStyleTarget(JSON.stringify([userId,character.id]))}/>}
    {character&&styleTarget===JSON.stringify([userId,character.id])&&<Suspense fallback={<p role="status">正在打开造型间…</p>}><StyleWorkspace key={`${userId}:${character.id}`} character={character} userId={userId} onClose={()=>setStyleTarget(undefined)}/></Suspense>}
    {open&&<ChatAppearanceEditor key={`${userId}:${character?.id??'global'}:${session}`} character={character} userId={userId} onClose={()=>setOpen(false)}/>}</>;
}
export function ChatAppearanceEditor({character,userId,onClose,workspace=false,onEditStyle}:{character?:Character;userId:string;onClose:()=>void;workspace?:boolean;onEditStyle?:()=>void}) {
  const currentOwner=useAuthStore(s=>s.userId),currentRole=useChatStore(s=>s.selectedCharacterId);
  const {config:effective}=useChatAtmosphere(character,userId);
  const [draft,setDraft]=useState<ChatBackgroundConfig>(()=>structuredClone(effective));
  const [scope,setScope]=useState<'role'|'global'>(character?'role':'global'),[strategy,setStrategy]=useState<GlobalChatBackground['strategy']>(()=>readBackgroundRows(userId).global.strategy);
  const [saving,setSaving]=useState(false),[processing,setProcessing]=useState(false),[error,setError]=useState(''),[discard,setDiscard]=useState(false),[follow,setFollow]=useState(false),[image,setImage]=useState<ImageDraft>();
  const [fresh,setFresh]=useState(false);
  const [section,setSection]=useState('素材');
  const avatarField=useRef<HTMLInputElement>(null),avatarEpoch=useRef(0),avatarAbort=useRef<AbortController|undefined>(undefined);
  const [avatarBusy,setAvatarBusy]=useState(false);
  const [previewMode,setPreviewMode]=useState<'light'|'dark'>(()=>document.documentElement.classList.contains('dark')?'dark':'light'),[keyboard,setKeyboard]=useState(false),[streaming,setStreaming]=useState(false);
  const original=useRef(''),revisions=useRef({role:0,global:0}),initialized=useRef(false),mounted=useRef(true),lock=useRef(false),generation=useRef(0),controller=useRef<AbortController|undefined>(undefined),field=useRef<HTMLInputElement>(null);
  const ready=useChatBackgroundStore(s=>s.ready[userId]),storageError=useChatBackgroundStore(s=>s.errors[userId]),ownerRole=useRef(currentRole),roleId=character?.id??'';
  useEffect(()=>{
    if(!workspace||!roleId)return;
    const subscription=liveQuery(()=>db.characters.get(roleId)).subscribe({next:role=>{if(!role)onClose();},error:()=>setError('角色资料暂时无法读取，请稍后再保存。')});
    return()=>subscription.unsubscribe();
  },[workspace,roleId,onClose]);
  useEffect(()=>{
    if(currentOwner!==userId||character&&currentRole!==ownerRole.current){onClose();return;}
    if(!ready||!fresh||initialized.current)return;
    initialized.current=true;const rows=readBackgroundRows(userId,roleId),config=structuredClone(effective);
    setDraft(config);setStrategy(rows.global.strategy);revisions.current={role:rows.roleRow?.revision??0,global:rows.globalRow?.revision??0};
    original.current=JSON.stringify({draft:config,scope:character?'role':'global',strategy:rows.global.strategy,follow:false});
  },[currentOwner,currentRole,ready,fresh,effective,character,userId,roleId,onClose]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;controller.current?.abort();avatarEpoch.current++;avatarAbort.current?.abort();};},[]);
  // Refresh revisions on each editor open, including updates from another window.
  useEffect(()=>{let alive=true;void ensureChatBackground(userId,true).then(()=>{if(alive)setFresh(true);});return()=>{alive=false;};},[userId]);
  useEffect(()=>{
    if(!draft.imageAssetId)return;let alive=true;
    void chatBackgroundRepo.asset(userId,draft.imageAssetId).then(async asset=>{
      if(!alive)return;
      if(!asset){setImage(undefined);setError('本地图片已不可用，请重新选择图片。原设置不会被自动覆盖。');return;}
      const bitmap=await createImageBitmap(asset.display);bitmap.close();
      if(alive)setImage(previous=>previous?.id===asset.id?previous:{source:asset.source,display:asset.display,width:asset.width,height:asset.height,blur:asset.blur,id:asset.id});
    }).catch(()=>{if(alive){setImage(undefined);setError('本地图片未能读取，请重新选择图片。原设置不会被自动覆盖。');}});
    return()=>{alive=false;};
  },[draft.imageAssetId,userId]);
  useEffect(()=>{
    if(!image||image.blur===draft.blur)return;
    const abort=new AbortController();let alive=true;
    setProcessing(true);
    const timer=setTimeout(()=>{void renderBackgroundImage(image.source,draft.blur,abort.signal).then(display=>{if(alive)setImage(previous=>previous&&previous.source===image.source?{...previous,display,blur:draft.blur,id:undefined}:previous);}).catch(cause=>{if(alive&&!abort.signal.aborted)setError(cause instanceof Error?cause.message:'图片柔化失败。');}).finally(()=>{if(alive)setProcessing(false);});},180);
    return()=>{alive=false;clearTimeout(timer);abort.abort();};
  },[draft.blur,image?.source,image?.blur]);
  const change=(patch:Partial<ChatBackgroundConfig>)=>{if(lock.current)return;setDraft(value=>({...value,...patch}));setFollow(false);setError('');};
  const visual=(patch:Partial<NonNullable<ChatBackgroundConfig['roleVisual']>>)=>{if(lock.current)return;setDraft(value=>({...value,roleVisual:{...value.roleVisual,...patch}}));setFollow(false);setError('');};
  const pickAvatar=async(file?:File)=>{
    if(!file||lock.current)return;const epoch=++avatarEpoch.current;avatarAbort.current?.abort();const abort=new AbortController();avatarAbort.current=abort;setAvatarBusy(true);setError('');
    try{const avatar=await prepareStyleAvatar(file,abort.signal);if(mounted.current&&epoch===avatarEpoch.current)visual({avatar});}
    catch(cause){if(!abort.signal.aborted&&mounted.current&&epoch===avatarEpoch.current)setError(cause instanceof Error?cause.message:'头像处理失败，请重试。');}
    finally{if(mounted.current&&epoch===avatarEpoch.current)setAvatarBusy(false);}
  };
  const cropAvatar=async(key:'x'|'y'|'zoom',value:number)=>{
    const avatar=draft.roleVisual?.avatar;if(!avatar||lock.current)return;
    const epoch=++avatarEpoch.current;avatarAbort.current?.abort();const abort=new AbortController();avatarAbort.current=abort;
    const next={...avatar,[key]:value};visual({avatar:next});setAvatarBusy(true);setError('');
    try{const image=await cropStyleAvatar(next.source,next.x,next.y,next.zoom,abort.signal);if(mounted.current&&epoch===avatarEpoch.current)visual({avatar:{...next,image}});}
    catch(cause){if(!abort.signal.aborted&&mounted.current&&epoch===avatarEpoch.current)setError(cause instanceof Error?cause.message:'头像裁剪失败。');}
    finally{if(mounted.current&&epoch===avatarEpoch.current)setAvatarBusy(false);}
  };
  const replaceDraft=(config:ChatBackgroundConfig)=>{
    if(lock.current)return false;
    generation.current++;controller.current?.abort();setProcessing(false);
    // Shared role/global assets may keep the same id, so no asset-read effect
    // will run again. Retain that already loaded image; clear other drafts.
    setImage(previous=>config.mode==='image'&&config.imageAssetId&&previous?.id===config.imageAssetId?previous:undefined);
    setDraft(config);return true;
  };
  const resetDraft=()=>{if(lock.current)return;const rows=readBackgroundRows(userId);replaceDraft(structuredClone(resolveChatBackground(character,rows.global,undefined).config));avatarEpoch.current++;avatarAbort.current?.abort();setAvatarBusy(false);setScope('role');setFollow(true);setError('');};
  const dirty=initialized.current&&JSON.stringify({draft,scope,strategy,follow})!==original.current;
  const cancel=()=>{if(lock.current)return;if(dirty)setDiscard(true);else onClose();};
  const pick=async(file?:File)=>{
    if(!file||lock.current)return;const token=++generation.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setProcessing(true);setError('');
    try{const normalized=await normalizeBackgroundImage(file,abort.signal),display=await renderBackgroundImage(normalized.source,draft.blur,abort.signal);if(!mounted.current||token!==generation.current)return;setImage({...normalized,display,blur:draft.blur});change({mode:'image',imageAssetId:undefined});}
    catch(cause){if(mounted.current&&token===generation.current&&!(cause instanceof DOMException&&cause.name==='AbortError'))setError(cause instanceof Error?cause.message:'图片处理失败，请换一张。');}
    finally{if(mounted.current&&token===generation.current)setProcessing(false);}
  };
  const save=async()=>{
    if(lock.current||processing||avatarBusy||!ready||!fresh)return;lock.current=true;setSaving(true);setError('');controller.current?.abort();const abort=new AbortController();controller.current=abort;
    try{
      if(useAuthStore.getState().userId!==userId||character&&useChatStore.getState().selectedCharacterId!==ownerRole.current)throw Error('background:owner');
      if(workspace&&character){const source=await db.characters.get(character.id);if(!source||!source.isPreset&&source.createdBy!==userId)throw Error('background:owner');}
      const target=scope==='role'?roleId:'';
      if(follow&&target){await chatBackgroundRepo.resetRole(userId,target,revisions.current.role);forgetRoleBackground(userId,target);}
      else{
        let config=normalizeChatBackground(draft).config,prepared:Omit<BackgroundAsset,'userId'|'createdAt'>|undefined;
        if(config.mode==='image'){
          if(!image)throw Error('background:missing');
          const display=image.blur===config.blur?image.display:await renderBackgroundImage(image.source,config.blur,abort.signal),needsNew=!image.id||image.blur!==config.blur,assetId=needsNew?`bg:${crypto.randomUUID()}`:image.id!;
          config={...config,imageAssetId:assetId};if(needsNew)prepared={id:assetId,source:image.source,display,width:image.width,height:image.height,blur:config.blur};
        }
        if(abort.signal.aborted)throw Error('background:owner');
        publishBackground(await chatBackgroundRepo.save(userId,target,config,target?revisions.current.role:revisions.current.global,strategy,prepared));
      }
      if(mounted.current)onClose();
    }catch(cause){if(mounted.current)setError(chatBackgroundError(cause));}finally{lock.current=false;if(mounted.current)setSaving(false);}
  };
  const previewConfig=useMemo(()=>({...draft,lightDarkPolicy:previewMode}),[draft,previewMode]);
  const sceneAppearance=resolveEffectiveSceneAppearance(draft.scene??DEFAULT_SCENE_PREFERENCES);
  const unsupported=(()=>{const rows=readBackgroundRows(userId,roleId);return [rows.globalRow,rows.roleRow].some(row=>row&&row.config?.schemaVersion!==1);})();
  const previewControls=<div className="vg-background-preview-controls" role="group" aria-label="仅预览效果">{(['dark','light'] as const).map(mode=><button type="button" key={mode} aria-pressed={previewMode===mode} onClick={()=>setPreviewMode(mode)}>{mode==='dark'?'深色':'浅色'}</button>)}<button type="button" aria-pressed={keyboard} onClick={()=>setKeyboard(!keyboard)}>键盘</button><button type="button" aria-pressed={streaming} onClick={()=>setStreaming(!streaming)}>长回复</button></div>;
  const avatarSlider=(key:'x'|'y'|'zoom')=><label key={key} className="vg-background-slider"><span>{key==='x'?'横向':key==='y'?'纵向':'缩放'}</span><input type="range" aria-label={`头像${key==='x'?'横向':key==='y'?'纵向':'缩放'}`} min={key==='zoom'?1:0} max={key==='zoom'?2:1} step=".01" value={draft.roleVisual?.avatar?.[key]??(key==='zoom'?1:.5)} onChange={event=>void cropAvatar(key,Number(event.target.value))}/></label>;
  return <>
    <Modal open title={workspace?'角色造型间':'聊天外观'} onClose={cancel} onBack={cancel} backLabel={workspace?'返回':'取消'} mobileFullHeight closeOnBackdrop={false} panelClassName={`vg-background-editor${workspace?' vg-style-workspace':' vg-settings-panel vg-light-paper vg-background-paper'}`} canSnapshotOnExit={()=>false}
      headerActions={workspace?<button type="button" aria-label="关闭造型间" className="vg-settings-back" onClick={cancel}><Icon name="close" size={20}/></button>:<button type="button" className="vg-background-save" disabled={saving||processing||!ready||!fresh||unsupported} aria-busy={saving} onClick={()=>void save()}>{saving?'保存中':'保存'}</button>}
      footer={workspace?<div className="vg-background-discard"><button type="button" disabled={saving} onClick={resetDraft}>恢复默认</button><button type="button" className="vg-background-save" disabled={saving||processing||avatarBusy||!ready||!fresh||unsupported} aria-busy={saving} onClick={()=>void save()}>{saving?'保存中…':'保存外观'}</button></div>:undefined}>
      <fieldset disabled={saving||!fresh} className="vg-settings-design vg-background-editor-body" style={{border:0,minWidth:0,margin:0}} aria-busy={processing||saving}>
        {!workspace&&<GlassSurface roleType="content" quality="static" className="vg-background-scope-surface"><div className="vg-background-scope-note" role="status"><strong>{scope==='role'?`当前角色 · ${character?.name??'聊天'}`:'全局默认'}</strong><span>{follow?'保存后恢复跟随全局':scope==='role'?'保存后仅此角色使用独立外观':'仅影响跟随全局的角色'}</span><small>{!fresh?'正在读取当前外观':dirty?'预览未保存':'当前保存的外观'} · 不修改人物性格与世界设定</small></div></GlassSurface>}
        {(!ready||storageError)&&<><FeedbackNotice tone="error" message={storageError||'正在读取本地聊天外观…'}/><button type="button" onClick={()=>void ensureChatBackground(userId,true)}>重试读取</button></>}
        {unsupported&&<FeedbackNotice tone="error" message="本机存有更新版本外观，暂用安全主题。本版本不会覆盖原设置。"/>}{error&&<FeedbackNotice tone="error" message={error}/>}
        {workspace&&<p className="text-center text-sm text-sub mb-3">仅此角色 · {dirty?'未保存':effective.roleVisual||readBackgroundRows(userId,roleId).roleRow?'独立外观':'跟随全局'}</p>}
        <div className={workspace?'vg-style-stage':undefined}>{!workspace&&previewControls}
        <CharacterStylePreview character={character} userId={userId} config={previewConfig} draftBlob={image?.display} keyboard={keyboard} longReply={streaming}/>
        </div>
        {workspace&&<><div className="vg-background-preview-controls" role="group" aria-label="造型分区">{['素材','色彩','背景','小球'].map(label=><button key={label} type="button" aria-pressed={section===label} onClick={()=>setSection(label)}>{label}</button>)}</div>
          <section hidden={section!=='素材'} aria-label="头像素材"><div className="p-4"><div className="flex items-center justify-between gap-4"><Avatar avatar={draft.roleVisual?.avatar?.image||character?.avatar||'TA'} size="lg" className="w-24 h-24"/><div className="flex flex-col gap-2"><button type="button" className="vg-background-save" disabled={saving} onClick={()=>avatarField.current?.click()}>{avatarBusy?'处理头像中…':'上传头像'}</button>{draft.roleVisual?.avatar&&<button type="button" className="h-11 text-sm text-sub" onClick={()=>{avatarEpoch.current++;avatarAbort.current?.abort();setAvatarBusy(false);visual({avatar:undefined});}}>原角色头像</button>}</div><input ref={avatarField} className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传角色头像" onChange={event=>{void pickAvatar(event.target.files?.[0]);event.target.value='';}}/></div>
          {draft.roleVisual?.avatar?<><p className="text-sm text-sub mt-4">头像位置</p>{avatarSlider('x')}{avatarSlider('y')}</>:<p className="text-sm text-sub mt-4">选择本机图片后可调整裁剪位置。只改变本机外观，角色原档案保留。</p>}</div></section>
        </>}
        <section hidden={workspace&&section!=='背景'}>
        <AppearanceExperienceControls value={draft.presentation} onChange={presentation=>change({presentation})}/>
        <SettingsGroup title="背景模式"><div className="vg-background-mode" role="group" aria-label="背景模式">{(['clean','atmosphere','image','scene'] as const).map((mode,i)=><button type="button" key={mode} aria-pressed={draft.mode===mode} disabled={saving} onClick={()=>change({mode,...(mode==='scene'?{scene:draft.scene??{...DEFAULT_SCENE_PREFERENCES}}:{})})}>{['纯净','氛围','图片','场景'][i]}</button>)}</div></SettingsGroup>
        {draft.mode==='scene'&&<>
          <SettingsGroup title="沉浸场景" scope="仅改变本机外观"><SceneChoices value={draft.scene?.id??DEFAULT_SCENE_PREFERENCES.id} onChange={id=>change({scene:{...DEFAULT_SCENE_PREFERENCES,...draft.scene,id}})}/><p className="vg-settings-intro px-4">窗前的雪、远处的海，或一盏温暖的灯。场景不会改变角色设定或故事地点。</p></SettingsGroup>
          <SettingsGroup title="场景时刻" scope="只改变场景外观"><SettingsChoices label="场景时刻" value={sceneAppearance.timeVariantId} onChange={timeVariantId=>change({scene:{...DEFAULT_SCENE_PREFERENCES,...draft.scene,timeVariantId}})} options={sceneAppearance.options.map(option=>({value:option.id,title:option.label}))}/>{sceneAppearance.reason&&<p role="status" className="vg-settings-intro px-4">{sceneAppearance.reason}</p>}<p className="vg-settings-intro px-4">手动固定，不改变消息时间、故事日期或提醒。未制作的时段不会显示。</p></SettingsGroup>
          <details className="vg-scene-advanced"><summary>更多画面选项<span>画质、空间效果与动态</span></summary><SettingsGroup title="场景画质"><SettingsChoices label="场景画质" value={draft.scene?.quality??'auto'} onChange={quality=>change({scene:{...DEFAULT_SCENE_PREFERENCES,...draft.scene,quality}})} options={[{value:'auto',title:'自动',detail:'清晰画面与轻柔动态'},{value:'rich',title:'精致',detail:'更细腻的画面与局部效果'},{value:'power-save',title:'省电',detail:'高清静态场景，不运行动画'}]}/></SettingsGroup>
          <SettingsGroup title="场景效果"><SettingsChoices label="场景效果" value={draft.scene?.renderer??DEFAULT_SCENE_PREFERENCES.renderer??'layered'} onChange={renderer=>change({scene:{...DEFAULT_SCENE_PREFERENCES,...draft.scene,renderer}})} options={[{value:'layered',title:'电影分层',detail:'清晰原图、局部光与轻柔粒子，适合日常聊天'},{value:'auto',title:'立体增强',detail:'保留已有空间效果，不支持时自动使用电影分层'}]}/></SettingsGroup>
          <SettingsGroup title="场景动态"><SettingsChoices label="场景动态" value={draft.scene?.motionEnabled!==false?'on':'off'} onChange={value=>change({scene:{...DEFAULT_SCENE_PREFERENCES,...draft.scene,motionEnabled:value==='on'}})} options={[{value:'on',title:'轻柔动态',detail:'输入时保留柔和光感，收起粒子；滚动、选字时暂停'},{value:'off',title:'关闭',detail:'保留完整清晰画面，头像动态可单独设置'}]}/><SettingsChoices label="轻微视差" value={draft.scene?.parallaxEnabled?'on':'off'} onChange={value=>change({scene:{...DEFAULT_SCENE_PREFERENCES,...draft.scene,parallaxEnabled:value==='on'}})} options={[{value:'off',title:'固定镜头'},{value:'on',title:'轻微视差',detail:'指针轻移时近景响应，不接管滑动'}]}/></SettingsGroup></details>
        </>}
        </section><section hidden={workspace&&section!=='色彩'}>
        <SettingsGroup title="主题"><div className="vg-background-swatches" role="group" aria-label="背景主题">{choices.map(theme=><button type="button" key={theme.id} aria-label={`背景主题：${theme.label}`} aria-pressed={draft.themeId===theme.id} disabled={saving} onClick={()=>{change({themeId:theme.id});setStrategy('fixed');}}><i style={{background:`linear-gradient(145deg,${theme[previewMode].accent},${theme[previewMode].panel})`}}/>{theme.label}</button>)}</div><p className="vg-settings-intro px-4">{getChatAtmosphereTheme(draft.themeId).description}</p></SettingsGroup>
        </section><section hidden={workspace&&section!=='背景'}>
        {draft.mode==='image'&&<SettingsGroup title="本地图片" scope="不上传、不同步"><input ref={field} type="file" className="sr-only" tabIndex={-1} accept="image/jpeg,image/png,image/webp" aria-label="选择聊天背景图片" onChange={event=>{void pick(event.target.files?.[0]);event.target.value='';}}/><button type="button" className="vg-preference-row w-full" disabled={saving} onClick={()=>field.current?.click()}><Icon name="image" size={20}/><span className="vg-preference-copy"><strong>{processing?'正在处理图片…':image?'重新选择图片':'选择本机图片'}</strong><small>JPEG、PNG、静态WebP · 15 MB / 2400万像素以内</small></span></button>{image&&<p className="vg-settings-intro px-4">已去除元数据 · {image.width} × {image.height}</p>}
          {([{key:'x',label:'横向焦点',min:0,max:1,step:.01,value:draft.focalPoint.x},{key:'y',label:'纵向焦点',min:0,max:1,step:.01,value:draft.focalPoint.y},{key:'zoom',label:'图片缩放',min:1,max:2,step:.01,value:draft.zoom},{key:'mask',label:'阅读遮罩',min:.35,max:.85,step:.01,value:draft.mask},{key:'blur',label:'图片柔化',min:0,max:12,step:1,value:draft.blur}] as const).map(slider=><label key={slider.key} className="vg-background-slider"><span>{slider.label}<small>{slider.key==='blur'?`${slider.value}px`:`${Math.round(slider.value*100)}%`}</small></span><input type="range" aria-label={slider.label} min={slider.min} max={slider.max} step={slider.step} value={slider.value} disabled={saving} onChange={event=>{const value=Number(event.target.value);if(slider.key==='x'||slider.key==='y')change({focalPoint:{...draft.focalPoint,[slider.key]:value}});else change({[slider.key]:value});}}/></label>)}
          <p className="vg-settings-intro px-4">保留原图纹理；想更柔和时再调整「图片柔化」。</p><button type="button" className="vg-preference-row w-full" disabled={saving||processing} onClick={()=>change({blur:0,mask:DEFAULT_CHAT_BACKGROUND.mask})}>清晰原图</button><button type="button" className="vg-preference-row w-full" disabled={saving} onClick={()=>change({focalPoint:{...DEFAULT_CHAT_BACKGROUND.focalPoint},zoom:DEFAULT_CHAT_BACKGROUND.zoom,mask:DEFAULT_CHAT_BACKGROUND.mask,blur:DEFAULT_CHAT_BACKGROUND.blur})}>恢复图片建议值</button></SettingsGroup>}
        </section><section hidden={workspace&&section!=='色彩'}><SettingsGroup title="明暗策略"><SettingsChoices label="聊天明暗策略" value={draft.lightDarkPolicy} disabled={saving} onChange={lightDarkPolicy=>change({lightDarkPolicy})} options={[{value:'app',title:'跟随应用'},{value:'dark',title:'始终深色'},{value:'light',title:'始终浅色'}]}/></SettingsGroup></section><section hidden={workspace&&section!=='背景'}>
        {draft.mode==='atmosphere'&&<SettingsGroup title="动态效果"><p className="vg-settings-intro px-4">{getChatBackgroundEffectProfile(draft.themeId).description}</p><SettingsChoices label="背景动效强度" value={draft.strength} disabled={saving} onChange={strength=>change({strength})} options={[{value:'off',title:'关闭',detail:'保留静态氛围'},{value:'gentle',title:'轻柔',detail:'全景柔光与舒缓流动的粒子'},{value:'vivid',title:'生动',detail:'更丰富的粒子、纵深与光感'}]}/><SettingsChoices label="背景特效" value={draft.effect} disabled={saving} onChange={effect=>change({effect})} options={[{value:'glow',title:'沉浸氛围',detail:'柔光与疏朗粒子，覆盖整个聊天背景'},{value:'dust',title:'丰盈粒子',detail:'更密集的花雨、萤火或星群，随主题变化'}]}/></SettingsGroup>}
        </section>
        {workspace&&<section hidden={section!=='小球'}><SettingsGroup title="小球色彩"><SettingsChoices label="角色小球颜色" value={draft.roleVisual?.orbColor??'inherit'} onChange={value=>visual({orbColor:value==='inherit'?undefined:value as NonNullable<ChatBackgroundConfig['roleVisual']>['orbColor']})} options={[{value:'inherit',title:'跟随全局'},...ORB_COLORS.map(color=>({value:color.id,title:color.id==='auto'?'跟随主题':color.name}))]}/></SettingsGroup><SettingsGroup title="小球动作"><SettingsChoices label="角色小球动作" value={draft.roleVisual?.orbMotion??'inherit'} onChange={value=>visual({orbMotion:value==='inherit'?undefined:value as NonNullable<ChatBackgroundConfig['roleVisual']>['orbMotion']})} options={[{value:'inherit',title:'跟随全局'},{value:'gentle',title:'轻柔'},{value:'lively',title:'活泼'},{value:'reduced',title:'静态'}]}/></SettingsGroup></section>}
        {!workspace&&<SettingsGroup title="作用范围"><SettingsChoices label="外观作用范围" value={scope} disabled={saving} onChange={value=>{setScope(value);setFollow(false);}} options={[...(character?[{value:'role' as const,title:'应用到当前角色',detail:'保存完整外观，不随全局改变'}]:[]),{value:'global',title:'设为全局默认',detail:'仅影响跟随全局的角色'}]}/>{scope==='global'&&<SettingsChoices label="全局主题策略" value={strategy} disabled={saving} onChange={setStrategy} options={[{value:'characterRecommended',title:'跟随角色推荐',detail:'已有性格决定配色，信息不足使用雾月'},{value:'fixed',title:'统一使用所选主题'}]}/>}
          {character&&<button type="button" className="vg-preference-row w-full" disabled={saving} onClick={()=>{if(lock.current)return;const rows=readBackgroundRows(userId);replaceDraft(structuredClone(resolveChatBackground(character,rows.global,undefined).config));setStrategy(rows.global.strategy);setScope('role');setFollow(true);setError('');}}><span className="vg-preference-copy"><strong>恢复跟随全局</strong><small>{follow?'保存后删除此角色的独立设置':'保留全局与其他角色设置'}</small></span></button>}
          <button type="button" className="vg-preference-row w-full" disabled={saving} onClick={()=>{if(!replaceDraft(structuredClone(DEFAULT_CHAT_BACKGROUND)))return;setScope(character?'role':'global');setStrategy(DEFAULT_GLOBAL_BACKGROUND.strategy);setFollow(false);setError('');}}><span className="vg-preference-copy"><strong>恢复应用默认</strong><small>{character?'此角色恢复星域观景舱与轻柔动态':'恢复全局星域观景舱与轻柔动态，独立角色设置保留'}</small></span></button></SettingsGroup>}
        {workspace&&onEditStyle&&<button type="button" className="vg-preference-row w-full" onClick={onEditStyle}><span className="vg-preference-copy"><strong>说话风格</strong><small>修改表达方式，不改变外观</small></span><Icon name="chevron" size={18}/></button>}
        {workspace&&section==='素材'&&draft.roleVisual?.avatar&&<details><summary className="vg-preference-row">更多头像调整<Icon name="chevron" size={18}/></summary>{avatarSlider('zoom')}</details>}
        {workspace&&<details><summary className="vg-preference-row">预览选项<Icon name="chevron" size={18}/></summary>{previewControls}</details>}
        <p className="vg-settings-intro">保存前只改变预览。系统减少动效时装饰静止；图片仅存在本机，不会交给模型。</p>
      </fieldset>
    </Modal>
    <Modal open={discard} title="放弃未保存的外观？" onClose={()=>setDiscard(false)} presentation="dialog" panelClassName="vg-light-paper" canSnapshotOnExit={()=>false}><p className="p-5 text-sub">原聊天背景会保持不变。</p><div className="vg-background-discard"><button type="button" onClick={()=>setDiscard(false)}>继续编辑</button><button type="button" onClick={()=>{controller.current?.abort();onClose();}}>放弃修改</button></div></Modal>
  </>;
}
