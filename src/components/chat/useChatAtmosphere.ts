import { useMemo, useLayoutEffect, useEffect, type CSSProperties, type RefObject } from 'react';
import type { Character } from '../../db';
import { getChatAtmosphereVariables } from '../../lib/chat-atmosphere';
import { useChatBackgroundStore, ensureChatBackground } from '../../store/chat-background-store';
import { backgroundSettingKey } from '../../db/chat-background-repo';
import { DEFAULT_GLOBAL_BACKGROUND, normalizeChatBackground, resolveChatBackground, type ChatBackgroundConfig } from '../../lib/chat-background-config';
import { useSettingsStore } from '../../store/settings-store';
import { getSceneReadingVariables } from '../../lib/chat-scene/scene-reading';
import {resolveExperience} from '../../lib/ui/appearance-policy';
import {createSceneRuntime} from '../../lib/chat-scene/scene-runtime';
import {DEFAULT_SCENE_PREFERENCES} from '../../lib/chat-scene/scene-registry';

export function backgroundStyle(config: ChatBackgroundConfig, secondary?: Parameters<typeof getChatAtmosphereVariables>[1]): CSSProperties {
  const variables=config.mode==='scene'?getSceneReadingVariables(config.scene?.id):getChatAtmosphereVariables(config.themeId,secondary);
  const experience=resolveExperience(config.presentation);
  if(experience.transparency==='solid'){
    variables['--vg-glass-control-bg']='var(--bg-panel)';variables['--vg-glass-content-bg']='var(--bg-panel)';variables['--vg-glass-reading-bg']='var(--bg-panel)';variables['--vg-glass-blur']='0px';variables['--vg-glass-sample']='none';
  }else if(experience.transparency==='clear'){
    variables['--vg-glass-control-bg']='color-mix(in srgb,var(--bg-panel) 42%,transparent)';variables['--vg-glass-content-bg']='color-mix(in srgb,var(--bg-panel) 66%,transparent)';
  }
  if(experience.preset!=='cinematic')variables['--vg-glass-sample']='none';
  if (config.mode === 'scene') {
    // Opaque reading surfaces protect actual text independently of bright windows or night imagery.
    variables['--msg-user-text']='var(--chat-text)';
  }
  if(config.lightDarkPolicy!=='app')for(const [key,value] of Object.entries(variables)) {
    const prefix=`--chat-${config.lightDarkPolicy}-`;
    if(key.startsWith(prefix))variables[`--chat-${key.slice(prefix.length)}`]=value;
  }
  return variables as CSSProperties;
}

export function useChatAtmosphere(character: Character | undefined, userId: string) {
  const ready=useChatBackgroundStore(s=>s.ready[userId]);
  const globalRow=useChatBackgroundStore(s=>s.rows[backgroundSettingKey(userId,'')]);
  const roleRow=useChatBackgroundStore(s=>character?s.rows[backgroundSettingKey(userId,character.id)]:undefined);
  const enabled=useSettingsStore(s=>s.chatBackgroundEnabled);
  const storageError=useChatBackgroundStore(s=>s.errors[userId]);
  useEffect(()=>{void ensureChatBackground(userId);},[userId]);
  const resolution=useMemo(()=>{
    const global=globalRow?{strategy:globalRow.strategy==='fixed'?'fixed' as const:'characterRecommended' as const,config:normalizeChatBackground(globalRow.config).config}:DEFAULT_GLOBAL_BACKGROUND;
    return resolveChatBackground(character,global,roleRow?normalizeChatBackground(roleRow.config).config:undefined);
  },[character,globalRow,roleRow]);
  const config=enabled?resolution.config:{...resolution.config,mode:'clean' as const,strength:'off' as const};
  const primary=config.themeId,secondary=resolution.secondary;
  const style=useMemo(()=>backgroundStyle(config,secondary),[primary,secondary,config.lightDarkPolicy,config.mode,config.scene?.id,config.presentation]);
  return { motion:config.strength,defaults:resolution.recommended,primary,secondary,style,config,independent:resolution.independent,ready,storageError };
}

/** Pause only decoration; scroll frames never publish React state or touch message rows. */
export function useChatAtmosphereRest(roomRef: RefObject<HTMLDivElement | null>, scope: string, config?:ChatBackgroundConfig) {
  useLayoutEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    let alive = true, scrolling = false, timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      if (!alive) return;
      const viewport = window.visualViewport;
      const keyboard = !!viewport && window.innerHeight - viewport.height - viewport.offsetTop > 120;
      room.toggleAttribute('data-chat-resting', scrolling);
      room.toggleAttribute('data-chat-keyboard',keyboard);
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest('.chat-thread')) return;
      scrolling = true; sync(); clearTimeout(timer);
      timer = setTimeout(() => { scrolling = false; sync(); }, 180);
    };
    const focus = () => sync();
    const runtime=config?.mode!=='scene'?createSceneRuntime(room,{...DEFAULT_SCENE_PREFERENCES,motionEnabled:config?.strength!=='off',experience:config?.presentation},'balanced',({policy})=>{room.dataset.chatAmbient=policy.ambient??'off';room.dataset.chatAvatar=policy.avatar??'off';room.dataset.chatParticles=policy.particles??'off';}):undefined;
    room.addEventListener('scroll', scroll, { capture: true, passive: true });
    room.addEventListener('focusin', focus);
    // focusout runs before the new activeElement is assigned.
    const blurred = () => queueMicrotask(focus);
    room.addEventListener('focusout', blurred);
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
    focus();
    return () => {
      alive = false; clearTimeout(timer);runtime?.dispose(); room.removeAttribute('data-chat-resting');
      room.removeEventListener('scroll', scroll, true); room.removeEventListener('focusin', focus);
      room.removeEventListener('focusout', blurred);
      window.visualViewport?.removeEventListener('resize', sync); window.visualViewport?.removeEventListener('scroll', sync);
    };
  }, [roomRef, scope,config?.mode,config?.strength,config?.presentation]);
}
