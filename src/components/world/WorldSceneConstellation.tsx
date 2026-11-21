
import type { Character, WorldScene, WorldSceneEntry } from '../../db/index';
import { Avatar } from '../ui/Avatar';
import { WorldCompactText } from './WorldCompactText';
import '../../styles/scene-detail-paper.css';
import '../../styles/world-scene-directory.css';
import '../../styles/starfield-detail.css';
import '../../styles/world-scene-refinement.css';

function statusLabel(status: WorldScene['status']): string {
  return status === 'active' ? '进行中' : status === 'paused' ? '已暂停' : status === 'finished' ? '已保存' : '未开始';
}
function entryLabel(entry: WorldSceneEntry, characters: Character[]): string {
  if (entry.kind === 'user_input') return '你';
  if (entry.kind === 'narration') return '旁白';
  if (entry.kind === 'choice') return '选择';
  return characters.find(c => c.id === entry.speakerId)?.name ?? '记录';
}
export function WorldSceneConstellation({ scene, entries, characters, busy, issue, onRetry, onContinue }: {
  scene: WorldScene; entries: WorldSceneEntry[]; characters: Character[]; busy: boolean; issue?: string;
  onRetry: () => void; onContinue: () => void;
}) {
  const ownedCharacters = characters.filter(character => character.createdBy === scene.userId);
  const cast = scene.characterIds.map(id => ownedCharacters.find(c => c.id === id)).filter((c): c is Character => !!c);
  const recent = entries.filter(e => e.kind !== 'system').slice(-3);
  return (
    <section className="vg-scene-constellation vg-sector-detail vg-starfield-scene-page" aria-label={`场景：${scene.title}`}>
      <header className="vg-sector-title">
        <WorldCompactText as="h2" text={scene.title} label="场景名称" />
        <span className={`vg-world-scene-status is-${scene.status}`}>{statusLabel(scene.status)}</span>
      </header>

      <div className="vg-sector-enter">
        <button type="button" className="vg-starfield-primary" disabled={busy} aria-busy={busy} onClick={onContinue}>
          {busy ? '正在打开…' : scene.status === 'finished' ? '回看这一幕' : scene.status === 'draft' ? '进入场景' : '继续这一幕'}
        </button>
      </div>

      {issue && (
        <div className="vg-sector-issue">
          <p role="alert">{issue}</p>
          <button type="button" className="vg-button vg-button-secondary" disabled={busy} onClick={onRetry}>重新读取场景</button>
        </div>
      )}

      <dl className="vg-sector-facts">
        <div><dt>地点</dt><dd><WorldCompactText text={scene.place || '未设定地点'} label="地点" /></dd></div>
        <div><dt>时间</dt><dd><WorldCompactText text={scene.timeLabel || '未设定时间'} label="时间" /></dd></div>
      </dl>

      <section className="vg-sector-cast" aria-label="参与角色">
        <h3>同行的人</h3>
        {cast.length ? (
          <ul className="vg-starfield-scene-page__cast-list" role="list">
            {cast.map(character => (
              <li key={character.id}>
                <Avatar avatar={character.avatar} size="sm" className="vg-sector-avatar" />
                <span>{character.name}</span>
              </li>
            ))}
          </ul>
        ) : <p>{scene.characterIds.length ? '参与角色资料暂不可用' : '这一幕只有你'}</p>}
      </section>

      <section className="vg-sector-recent" aria-label="最近发生">
        <h3>最近发生</h3>
        {recent.length ? (
          <ol className="vg-sector-recent-list" role="list">
            {recent.map(entry => (
              <li key={entry.id}>
                <p><b>{entryLabel(entry, ownedCharacters)}</b><span>{entry.content}</span></p>
              </li>
            ))}
          </ol>
        ) : <p className="vg-sector-empty">还没有新的片段</p>}
      </section>
    </section>
  );
}
