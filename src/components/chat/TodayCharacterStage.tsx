import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Character } from '../../db';
import { avatarImageSrc } from '../../lib/avatar';
import { getChatAtmosphereTheme, resolveCharacterAtmosphere } from '../../lib/chat-atmosphere';
import { readTodayStageCollapsed, saveTodayStageCollapsed, todayStageExcerpt, type TodayStageEntry } from '../../lib/today-character-stage';
import { useAuthStore } from '../../store/auth-store';
import { Icon } from '../ui/Icon';
import { useTodayStageSwipe } from './useTodayStageSwipe';
import '../../styles/today-character-stage.css';

const visitedOwners = new Set<string>();

function StagePortrait({ character }: { character: Character }) {
  const image = avatarImageSrc(character.avatar);
  const [failedSource, setFailedSource] = useState<string>();
  if (image && failedSource !== image) return <img src={image} alt={character.name} draggable={false} className="vg-today-portrait-image" decoding="async" onError={() => setFailedSource(image)} />;
  return <span className="vg-today-portrait-fallback" aria-label={`${character.name}的头像`}>
    <span>{image ? character.name.slice(0, 1) : character.avatar.trim() || character.name.slice(0, 1)}</span>
  </span>;
}

/** The hero is a view onto actual recent conversations; selection alone never navigates. */
export function TodayCharacterStage({ owner, entries, loading = false, onContinue, onChooseCharacter }: {
  owner: string | null;
  entries: readonly TodayStageEntry[];
  loading?: boolean;
  onContinue: (character: Character, source?: HTMLElement) => void;
  onChooseCharacter: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => readTodayStageCollapsed(owner));
  const [selectedId, setSelectedId] = useState<string>();
  const [firstVisit] = useState(() => !!owner && !visitedOwners.has(owner));
  const entrancePlayed = useRef(false);
  const contentId = useId();
  const portraitRef = useRef<HTMLDivElement>(null);
  const entry = entries.find(item => item.character.id === selectedId) ?? entries[0];
  const character = entry?.character;
  const selectedIndex = Math.max(0, entries.findIndex(item => item.character.id === character?.id));
  const swipe = useTodayStageSwipe(`${owner}|${collapsed}|${entries.map(item => item.character.id).join('|')}`, entries.length, selectedIndex, index => setSelectedId(entries[index]?.character.id));
  const themeStyle = useMemo(() => {
    const theme = getChatAtmosphereTheme(resolveCharacterAtmosphere(character).primary);
    return {
      '--today-light-accent': theme.light.accent, '--today-dark-accent': theme.dark.accent,
      '--today-light-glow': theme.light.glow, '--today-dark-glow': theme.dark.glow,
    } as CSSProperties;
  }, [character]);
  useEffect(() => {
    if (!owner || loading) return;
    if (visitedOwners.size > 64) visitedOwners.clear();
    visitedOwners.add(owner);
  }, [owner, loading]);
  useEffect(() => { if (character) entrancePlayed.current = true; }, [character]);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next); saveTodayStageCollapsed(owner, next);
  };
  const enter = () => {
    if (character && owner && useAuthStore.getState().userId === owner) onContinue(character, portraitRef.current?.querySelector<HTMLElement>('.vg-today-portrait-image,.vg-today-portrait-fallback') ?? undefined);
  };
  if (loading && !entry) return <section className="vg-today-stage is-loading" aria-label="正在读取最近对话" role="status">
    <span className="sr-only">正在读取最近对话</span>
    <div className="vg-today-skeleton" aria-hidden="true"><div><i /><i /><i /></div><i /></div>
  </section>;
  if (!entry) return <section className="vg-today-stage is-empty" aria-label="选择聊天角色">
    <div><h2>故事，从相遇开始</h2><p>选一位角色，开始你们的第一段对话。</p>
      <button type="button" className="vg-today-continue" onClick={onChooseCharacter}>去选角色<Icon name="chevron" size={18} /></button></div>
    <span className="vg-today-empty-mark" aria-hidden="true"><Icon name="connection" size={44} /></span>
  </section>;
  return <section className={`vg-today-stage${collapsed ? ' is-collapsed' : ''}`} style={themeStyle} data-stage-character={character!.id} aria-label="今日角色舞台">
    {collapsed ? <button type="button" className="vg-today-expand" onClick={toggle} aria-expanded={false}>
      <span>继续与你聊</span><strong>{character!.name}</strong><Icon name="chevron" size={18} />
    </button> : <>
      <button type="button" className="vg-today-collapse" onClick={toggle} aria-label="收起今日角色舞台" aria-expanded={true} aria-controls={contentId}><Icon name="chevron" size={18} /></button>
      <div ref={swipe.viewportRef} id={contentId} className="vg-today-viewport" style={{overflow:'hidden',touchAction:'pan-y',userSelect:'none'}} data-enter={firstVisit && !entrancePlayed.current ? 'first' : 'return'} data-no-page-swipe="true" role="group" aria-label="左右滑动切换推荐角色" aria-roledescription="轮播" tabIndex={entries.length > 1 ? 0 : undefined}>
      <div ref={swipe.railRef} className="vg-today-rail" style={{display:'flex'}}>
      {entries.map((item, index) => <div className="vg-today-composition" key={item.character.id} inert={index !== selectedIndex} aria-hidden={index !== selectedIndex}>
        <div className="vg-today-copy">
          <h2 title={item.character.name}>{item.character.name}</h2>
          {!!item.character.tags?.length && <p className="vg-today-traits">{item.character.tags.filter(tag => tag.trim()).slice(0, 2).join(' · ')}</p>}
          <p className="vg-today-excerpt" title={item.preview.content}>{todayStageExcerpt(item.preview.content) || '最近的对话已保留。'}</p>
          <button type="button" className="vg-today-continue" onClick={enter}>继续对话<Icon name="chevron" size={18} /></button>
        </div>
        <div ref={index === selectedIndex ? portraitRef : undefined} className="vg-today-portrait"><StagePortrait key={item.character.id} character={item.character} /></div>
      </div>)}
      </div></div>
      {entries.length > 1 && <div className="vg-today-selectors" role="group" aria-label="选择舞台角色">
        {entries.map((item,index) => <button type="button" key={item.character.id} onClick={() => swipe.goTo(index)} aria-label={`展示${item.character.name}`} aria-pressed={item.character.id === character!.id}>
          <span aria-hidden="true" /><span className="sr-only">{item.character.name}</span>
        </button>)}
      </div>}
    </>}
  </section>;
}
