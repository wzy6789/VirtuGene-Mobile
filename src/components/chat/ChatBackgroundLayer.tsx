import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { ChatBackgroundConfig } from '../../lib/chat-background-config';
import { chatBackgroundRepo } from '../../db/chat-background-repo';
import { useAuthStore } from '../../store/auth-store';
import { getChatBackgroundEffectProfile } from '../../lib/chat-background-effects';
import { ChatParticleField } from './ChatParticleField';
import { ChatSceneLayer } from './scene/ChatSceneLayer';

export const ChatBackgroundLayer = memo(function ChatBackgroundLayer({ config, userId, draftBlob, onImageError }: { config: ChatBackgroundConfig; userId:string; draftBlob?:Blob; onImageError?:(message:string)=>void }) {
  const owner=useAuthStore(state=>state.userId);
  const ref=useRef<HTMLDivElement>(null), [image,setImage]=useState<{blob:Blob;id:string;userId:string;draft?:Blob}|null>(null);
  const [resource,setResource]=useState<{image:NonNullable<typeof image>;url:string}|null>(null);
  const errorRef=useRef(onImageError);errorRef.current=onImageError;
  const key=config.mode==='image' ? draftBlob ? 'draft' : config.imageAssetId ?? 'missing' : '';
  useEffect(()=>{
    let alive=true;
    if(!key){setImage(null);return;}
    if(draftBlob){setImage({blob:draftBlob,id:key,userId,draft:draftBlob});return;}
    setImage(null);
    void (async()=>{
      try{
        const asset=config.imageAssetId ? await chatBackgroundRepo.asset(userId,config.imageAssetId):undefined;
        if(!alive)return;
        if(!asset){setImage(null);errorRef.current?.('本地背景图片暂不可用，已使用安全配色。可在聊天外观中重新选择图片。');return;}
        // Decode before replacing any visible resource. Stale async completion is ignored.
        const bitmap=await createImageBitmap(asset.display);bitmap.close();if(alive)setImage({blob:asset.display,id:key,userId});
      }catch{if(alive){setImage(null);errorRef.current?.('背景图片未能读取，聊天仍可正常使用。可在聊天外观中重试。');}}
    })();
    return()=>{alive=false;};
  },[key,draftBlob,userId,config.imageAssetId]);
  useEffect(()=>{
    if(!image){setResource(null);return;}
    const next=URL.createObjectURL(image.blob);setResource({image,url:next});
    return()=>URL.revokeObjectURL(next);
  },[image]);
  useLayoutEffect(()=>{
    const node=ref.current,room=node?.parentElement;if(!node||!room)return;
    let width=0,height=0,frame=0;
    const measure=()=>{
      const rect=room.getBoundingClientRect();if(!rect.width||!rect.height)return;
      const focused=room.contains(document.activeElement)&&document.activeElement?.matches('textarea,input,[contenteditable=true]');
      const viewport=window.visualViewport,keyboard=!!viewport&&window.innerHeight-viewport.height-viewport.offsetTop>120;
      // Freeze IME height changes, but a genuine width change needs a fresh camera crop.
      if((focused||keyboard)&&height&&Math.abs(width-rect.width)<1)return;
      if(width!==rect.width||height!==rect.height){width=rect.width;height=rect.height;node.style.setProperty('--chat-image-width',`${width}px`);node.style.setProperty('--chat-image-height',`${height}px`);}
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);observer.observe(room);room.addEventListener('focusout',schedule);measure();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();room.removeEventListener('focusout',schedule);};
  },[]);
  // Old role images never remain visible during a role/account change.
  const visibleImage=owner===userId&&!!resource&&resource.image===image&&image.userId===userId&&image.id===key&&image.draft===draftBlob;
  // Each renderer owns its inputs. Scene lighting never inherits the old hue/halo controls.
  let style:CSSProperties|undefined;
  if(config.mode==='image')style={ '--chat-image-mask':config.mask, '--chat-image-x':`${config.focalPoint.x*100}%`, '--chat-image-y':`${config.focalPoint.y*100}%`, '--chat-image-zoom':config.zoom } as CSSProperties;
  if(config.mode==='atmosphere'){
    const profile=getChatBackgroundEffectProfile(config.themeId),vivid=config.strength==='vivid';
    style={ '--chat-field-period':`${profile.period}s`, '--chat-field-sway':profile.sway, '--chat-light-angle':profile.angle, '--chat-light-origin':profile.origin,
      '--chat-light-cap':vivid?.26:.20, '--chat-light-low':vivid?.58:.42, '--chat-light-high':vivid?1:.82 } as CSSProperties;
  }
  return <div ref={ref} className="vg-chat-atmosphere-edge" data-background-mode={config.mode} data-background-effect={config.mode==='atmosphere'?config.effect:undefined} data-background-theme={config.mode==='atmosphere'?config.themeId:undefined} aria-hidden="true" style={style}>
    {config.mode==='scene'&&<ChatSceneLayer config={config}/>}
    {config.mode==='image'&&visibleImage&&<div className="vg-chat-background-image"><img src={resource.url} alt="" draggable={false}/><div/></div>}
    {config.mode==='atmosphere'&&<><div className="vg-chat-background-halo"/><ChatParticleField config={config}/></>}
  </div>;
});
