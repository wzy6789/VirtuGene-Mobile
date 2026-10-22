import { useState } from 'react';
import { SCENE_CATALOG } from '../../../lib/chat-scene/scene-catalog';
import { CHAT_SCENES } from '../../../lib/chat-scene/scene-registry';
import type { ImageVariant, SceneId } from '../../../lib/chat-scene/scene-types';
import '../../../styles/scene-choices.css';

type MoodFilter = 'all' | 'guofeng' | 'urban' | 'cosmic' | 'home' | 'cold' | 'lonely' | 'warm' | 'quiet';
const FILTERS: ReadonlyArray<{ id: MoodFilter; label: string }> = [
  { id: 'all', label: '全部场景' },
  { id: 'guofeng', label: '国风' },
  { id: 'urban', label: '都市' },
  { id: 'cosmic', label: '星域' },
  { id: 'home', label: '居家' },
  { id: 'cold', label: '冰冷' },
  { id: 'lonely', label: '冷清' },
  { id: 'warm', label: '温馨' },
  { id: 'quiet', label: '宁静' },
];

/** The category is only a gallery filter; changing it never changes the draft. */
export function SceneChoices({ value, onChange }: {
  value: SceneId;
  onChange: (id: SceneId) => void;
}) {
  const [filter, setFilter] = useState<MoodFilter>('all');
  const scenes = SCENE_CATALOG.filter(scene => filter === 'all' || (filter==='guofeng'||filter==='urban'||filter==='cosmic'?scene.style===filter:filter==='home'?scene.space==='home':scene.mood === filter));
  const selected = SCENE_CATALOG.find(scene => scene.id === value);
  const selectionHidden = selected && !scenes.some(scene => scene.id === value);

  return <div className="vg-scene-choices">
    <div className="vg-scene-choices-filters" role="group" aria-label="按氛围筛选场景">
      {FILTERS.map(item => <button
        key={item.id}
        type="button"
        aria-pressed={filter === item.id}
        onClick={() => setFilter(item.id)}
      >{item.label}</button>)}
    </div>
    {selectionHidden && <p className="vg-scene-choices-selection" role="status">
      已选：{selected.label}，切换分类不会改变选择。
    </p>}
    <div className="vg-scene-choices-grid" role="group" aria-label="聊天场景">
      {scenes.map(scene => {
        const definition = CHAT_SCENES.find(item => item.id === scene.id);
        const thumbnail = (definition as { thumbnail?: ImageVariant } | undefined)?.thumbnail;
        const image = thumbnail ?? definition?.poster[0];
        const active = scene.id === value;
        return <button
          className="vg-scene-choice"
          key={scene.id}
          type="button"
          aria-label={scene.label}
          aria-pressed={active}
          onClick={() => onChange(scene.id)}
        >
          <span className="vg-scene-choice-art" aria-hidden="true">
            {image && <img
              src={image.src}
              width={image.width}
              height={image.height}
              alt=""
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              draggable={false}
              onError={event => { event.currentTarget.style.visibility = 'hidden'; }}
            />}
            {active && <span className="vg-scene-choice-selected">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4.5 4.5L19 7" /></svg>
              已选
            </span>}
          </span>
          <span className="vg-scene-choice-copy">
            <strong>{scene.label}</strong>
            <span>{scene.description}</span>
          </span>
        </button>;
      })}
    </div>
    {scenes.length === 0 && <p className="vg-scene-choices-selection">这个分类还没有场景，试试其他氛围。</p>}
  </div>;
}
