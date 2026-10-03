import { isTopicRelated } from '../chat-conversation-state';
import type { WorldSceneEntry } from '../../db/index';

type AttentionEntry = Pick<WorldSceneEntry, 'kind' | 'content'> & Partial<Pick<WorldSceneEntry, 'index' | 'meta'>>;

export const WORLD_OBJECT_TOPIC_RULE = '不预设物件作为场景背景、主题、任务或悬念，也不主动添加物件来引导用户。只有用户主动提起某个物件，或明确对它采取相关行动后，才回应该内容；用户转向后跟随新话题。不得从旧物件记录、角色旧目标或模型自己的对白推断用户想调查它。“继续”“随便聊”“看看周围”本身不指定物件主题。';

function pausedObjectTopic(text: string): boolean {
  return /(?:别|不要)(?:再)?(?:提|说|问|纠结|管|盯)|不聊|先不说|放下|放一边|搁置/u.test(text);
}

/** Resolve continuation only from user-authored input, never model-selected props. */
function userObjectTopic(userText: string, entries: AttentionEntry[]): string {
  if (pausedObjectTopic(userText)) return '';
  if (!/^(?:继续[。！!\s]*$|然后呢[？?\s]*$|接着呢[？?\s]*$|它|那张|那封|那个|这张|这封|这个)/u.test(userText.trim())) return userText;
  const ordered = [...entries];
  if (ordered.every(entry => entry.index != null)) ordered.sort((a, b) => a.index! - b.index!);
  const previousUsers = ordered.filter(entry => entry.kind === 'user_input' && entry.content.trim() !== userText.trim());
  const previousUser = previousUsers[previousUsers.length - 1];
  return previousUser && !pausedObjectTopic(previousUser.content) ? `${userText} ${previousUser.content}` : userText;
}

export function userRaisedWorldObject(userText: string, name: string, entries: AttentionEntry[]): boolean {
  return isTopicRelated(userObjectTopic(userText, entries), name);
}

// These labels describe recent language use, not facts or character knowledge.
const COMMON = new Set(['可以', '什么', '怎么', '知道', '觉得', '已经', '还是', '一直', '一起', '真的', '不要', '没有', '因为', '所以', '如果', '只是', '继续', '刚才', '现在', '今天', '声音', '轻轻', '微微', '缓缓', '目光']);
const FUNCTION_CHARS = /[我你他她它们的了是这那着就也都把让在有不吗呢吧啊呀和与又很]/u;

/** Count shared phrases across separate beats, even when the wording changes. */
export function repeatedWorldMotifs(entries: AttentionEntry[]): string[] {
  const ordered = [...entries];
  if (ordered.every(entry => entry.index != null)) ordered.sort((a, b) => a.index! - b.index!);
  const counts = new Map<string, Set<string>>();
  let userBeat = 0;
  let hasUserBeat = false;
  for (const [index, entry] of ordered.slice(-40).entries()) {
    if (entry.kind === 'user_input' || entry.kind === 'choice') { userBeat += 1; hasUserBeat = true; continue; }
    if (!['dialogue', 'action', 'narration'].includes(entry.kind)) continue;
    const beat = typeof entry.meta?.beatId === 'string' ? entry.meta.beatId
      : hasUserBeat ? `user:${userBeat}` : `entry:${index}`;
    for (const chunk of entry.content.normalize('NFKC').match(/[\u4e00-\u9fff]{2,}|[a-zA-Z]{4,}/gu) ?? []) {
      const phrases = /^[a-zA-Z]/u.test(chunk) ? [chunk.toLowerCase()]
        : Array.from({ length: Math.min(5, chunk.length - 1) }, (_, offset) => offset + 2)
          .flatMap(length => Array.from({ length: chunk.length - length + 1 }, (_, start) => chunk.slice(start, start + length)));
      for (const phrase of phrases) {
        if (COMMON.has(phrase) || FUNCTION_CHARS.test(phrase)) continue;
        const beats = counts.get(phrase) ?? new Set<string>();
        beats.add(beat); counts.set(phrase, beats);
      }
    }
  }
  const ranked = [...counts].filter(([, beats]) => beats.size >= 3)
    .sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length);
  const motifs: string[] = [];
  for (const [phrase] of ranked) {
    if (motifs.some(value => value.includes(phrase))) continue;
    motifs.push(phrase);
    if (motifs.length === 5) break;
  }
  return motifs;
}

/** User-directed continuation can reopen a cooled subject; casual "continue" cannot. */
export function coolingWorldMotifs(userText: string, entries: AttentionEntry[], names: string[] = []): string[] {
  const topic = userObjectTopic(userText, entries);
  return repeatedWorldMotifs(entries).filter(motif =>
    !names.some(name => name.includes(motif)) && !isTopicRelated(topic, motif));
}

export function worldAttentionHint(motifs: string[]): string {
  return motifs.length ? `【本轮注意力】近期反复提及的内容：${motifs.join('、')}。这些仍是已知背景，不是每轮必须处理的任务。用户本轮没有继续追问时，不再围绕它们追问、猜测、反复查看或换个措辞制造同一个悬念；接住当前的人、动作和话题，允许平静相处。只有用户主动提起或对它采取相关行动时才重新展开，不得自行制造新变化来重启这个主题。` : '';
}
