/**
 * 世界流渲染（5.0.0 Living World §11 / §69 / §70）
 *
 * 硬性要求（这是"世界"与"群聊"的分界）：
 * - **禁止所有内容都用聊天气泡**。旁白是全宽低对比文本（无气泡）；
 *   角色对白用"名字 + 内容"；用户行动是轻量行动文本（不套气泡）。
 * - **连续同角色合并成一个视觉组**（§69）：对白 + 动作 + 对白 = 一个头像，不是三个。
 * - 世界痕迹**不弹数字**（§11.5）：只有一句"这一刻被世界记住了。"，点开才看到具体内容。
 */
import { useState } from 'react';
import type { Character, WorldSceneEntry } from '../../db/index';
import { Avatar } from '../ui/Avatar';
import { describeTurnArtifacts } from '../../lib/world/world-turn';
import { worldTurnRepo } from '../../db/world-turn-repo';

export type StreamGroup =
  | { kind: 'narration'; id: string; entry: WorldSceneEntry }
  | { kind: 'system'; id: string; entry: WorldSceneEntry }
  | { kind: 'user'; id: string; entry: WorldSceneEntry }
  | { kind: 'character'; id: string; characterId: string; entries: WorldSceneEntry[] };

/**
 * 把扁平的世界流合并成视觉组。
 * 纯函数 ⇒ 验收可以直接断言"连续同角色只有一个组"。
 */
export function groupStream(entries: WorldSceneEntry[]): StreamGroup[] {
  const groups: StreamGroup[] = [];
  for (const entry of entries) {
    if (entry.kind === 'suggestion') continue; // 灵感建议渲染在输入框上方，不占正文
    if (entry.kind === 'dialogue' || entry.kind === 'action') {
      const last = groups[groups.length - 1];
      if (last && last.kind === 'character' && last.characterId === (entry.speakerId ?? '')) {
        last.entries.push(entry);
        continue;
      }
      groups.push({ kind: 'character', id: entry.id, characterId: entry.speakerId ?? '', entries: [entry] });
      continue;
    }
    if (entry.kind === 'narration') {
      groups.push({ kind: 'narration', id: entry.id, entry });
      continue;
    }
    if (entry.kind === 'user_input' || entry.kind === 'choice') {
      groups.push({ kind: 'user', id: entry.id, entry });
      continue;
    }
    groups.push({ kind: 'system', id: entry.id, entry });
  }
  return groups;
}

/* ------------------------------------------------------------------ *
 * 世界痕迹：点开才看到"世界记住了什么"（§11.5）
 * ------------------------------------------------------------------ */
function WorldTrace({ turnId, content }: { turnId?: string; content: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<string[] | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && items === null && turnId) {
      const turn = await worldTurnRepo.getById(turnId);
      if (!turn) {
        setItems([]);
        return;
      }
      const artifacts = await describeTurnArtifacts(turn);
      setItems([...artifacts.events, ...artifacts.memories, ...artifacts.facts, ...artifacts.threads]);
    }
  };

  return (
    <div className="vg-trace">
      <button type="button" onClick={() => void toggle()} className="vg-trace-line">
        <span aria-hidden>✦</span>
        <span>{content}</span>
        <span className="vg-trace-more">{open ? '收起' : '看看记住了什么'}</span>
      </button>
      {open && (
        <div className="vg-trace-panel">
          {items === null ? (
            <p className="text-[11px] text-gray-500">正在读取…</p>
          ) : items.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-gray-500">
              这一刻被写进了你们的时间线，没有单独留下条目。
            </p>
          ) : (
            <ul className="space-y-1">
              {items.map((item, i) => (
                <li key={`${i}-${item}`} className="text-[11px] leading-relaxed text-gray-400">· {item}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CharacterGroup({ entries, character }: { entries: WorldSceneEntry[]; character?: Character }) {
  const name = character?.name ?? '某人';
  return (
    <div className="vg-beat">
      <Avatar avatar={character?.avatar ?? '🙂'} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="vg-beat-name">{name}</p>
        {entries.map((entry) => (
          entry.kind === 'action' ? (
            <p key={entry.id} className="vg-beat-action">{entry.content}</p>
          ) : (
            <p key={entry.id} className="vg-beat-line">{entry.content}</p>
          )
        ))}
      </div>
    </div>
  );
}

export function WorldStream({ entries, characters }: { entries: WorldSceneEntry[]; characters: Character[] }) {
  const groups = groupStream(entries);
  const byId = new Map(characters.map((c) => [c.id, c]));
  return (
    <div className="vg-stream">
      {groups.map((group) => {
        if (group.kind === 'narration') {
          return <p key={group.id} className="vg-narration">{group.entry.content}</p>;
        }
        if (group.kind === 'user') {
          return <p key={group.id} className="vg-user-action">你{group.entry.content.startsWith('你') ? group.entry.content.slice(1) : `：${group.entry.content}`}</p>;
        }
        if (group.kind === 'character') {
          return <CharacterGroup key={group.id} entries={group.entries} character={byId.get(group.characterId)} />;
        }
        if (group.entry.meta?.trace) {
          return <WorldTrace key={group.id} content={group.entry.content} {...(typeof group.entry.meta.turnId === 'string' ? { turnId: group.entry.meta.turnId as string } : {})} />;
        }
        return <p key={group.id} className="vg-system-note">{group.entry.content}</p>;
      })}
    </div>
  );
}
