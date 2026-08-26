import type { Diary } from '../../db/index';
import { formatDiaryHeader, moodEmoji, moodColor, DIARY_MOODS } from '../../lib/diary-utils';

interface Props {
  diary: Diary;
}

/**
 * 正式日记格式视图：日期（年月日 星期）+ 天气 + 标题 + 段落正文。
 * 聊天只是写作辅助，最终以这个格式阅读与存储。
 */
export function DiaryView({ diary }: Props) {
  const mood = diary.mood ?? 3;
  const paragraphs = diary.content
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="max-w-2xl mx-auto">
      {/* 纸面感容器 */}
      <div className="rounded-2xl border border-line bg-panel/70 px-6 py-6 shadow-[0_4px_20px_rgba(15,15,26,0.06)]">
        {/* 抬头：日期 星期 天气 心情 */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-line">
          <div className="flex items-center gap-2 text-sm text-sub">
            <span className="font-medium text-ink">{formatDiaryHeader(diary.date)}</span>
            {diary.weather && <span title="天气">{diary.weather}</span>}
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span>{moodEmoji(mood)}</span>
            <span style={{ color: moodColor(mood) }}>
              {DIARY_MOODS.find((m) => m.value === mood)?.label ?? '一般'}
            </span>
          </div>
        </div>

        {/* 标题 */}
        {diary.title && (
          <h1 className="text-xl font-bold text-ink mt-4 mb-3">{diary.title}</h1>
        )}

        {/* 正文段落 */}
        {paragraphs.length === 0 ? (
          <p className="text-gray-400 text-sm mt-4">（还没有内容）</p>
        ) : (
          <div className="mt-4 space-y-3">
            {paragraphs.map((p, i) => (
              <p key={i} className="text-[15px] leading-[1.9] text-ink/90 whitespace-pre-wrap">
                {p}
              </p>
            ))}
          </div>
        )}

        {/* 插图 */}
        {diary.images && diary.images.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {diary.images.map((img, i) => (
              <img
                key={i}
                src={img}
                alt={`日记插图 ${i + 1}`}
                className="w-full rounded-lg border border-line object-cover max-h-64"
              />
            ))}
          </div>
        )}

        {/* 标签 */}
        {(diary.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-5 pt-3 border-t border-line">
            {(diary.tags ?? []).map((t) => (
              <span key={t} className="px-2 py-0.5 rounded-full bg-gene-purple/10 text-gene-purple text-[11px]">
                #{t}
              </span>
            ))}
          </div>
        )}

        {/* AI 回信批注：翻旧日记时，老朋友留下的悄悄话 */}
        {diary.aiNote && (
          <div className="mt-5 rounded-xl border border-life-cyan/25 bg-life-cyan/5 px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-sm">💌</span>
              <span className="text-[11px] tracking-[0.15em] text-life-cyan uppercase">来自时光的批注</span>
            </div>
            <p className="text-sm text-sub leading-relaxed">{diary.aiNote}</p>
          </div>
        )}
      </div>
    </div>
  );
}
