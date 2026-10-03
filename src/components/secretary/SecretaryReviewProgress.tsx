import { useState } from 'react';
import { localDateKey } from '../../db/todo-repo';
import type { DailyReviewTodoRow } from '../../lib/secretary/daily-review';

const GROUPS = [
  { state: 'completed-that-day', label: '当日完成' },
  { state: 'pending', label: '仍待办理' },
  { state: 'next-day', label: '次日已有安排' },
] as const;

/** Read-only progress. A checked step has no date and is not a daily accomplishment. */
export function SecretaryReviewProgress({ rows, date, onOpen }: { rows: DailyReviewTodoRow[]; date: string; onOpen: (row: DailyReviewTodoRow) => void }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  return <details className="rounded-2xl border border-line p-4">
    <summary className="min-h-11 cursor-pointer text-sm font-medium text-ink">查看办事进展与下一步</summary>
    <div aria-label="办事进展预览" className="mt-3 space-y-4">
      <p className="text-xs leading-relaxed text-sub">{date === localDateKey() ? '步骤显示当前进度，不代表今天完成。整件待办是否完成，以实际待办状态为准。' : '历史整理按整件待办的实际完成日期归类，不引用当前步骤进度。'}</p>
      {GROUPS.map(group => {
        const all = rows.filter(row => row.state === group.state);
        const shown = expanded.includes(group.state) ? all : all.slice(0, 8);
        return <section key={group.state} aria-label={group.label} className="space-y-2">
          <p className="text-xs font-medium text-ink">{group.label} · {all.length}</p>
          {!all.length && <p className="text-xs text-sub">暂无事项</p>}
          {shown.map((row, index) => {
            const remaining = row.currentSteps?.filter(step => !step.completed) ?? [];
            return <div key={`${row.id}:${row.date ?? ''}:${index}`} className="rounded-xl bg-surface p-3">
              <button type="button" onClick={() => onOpen(row)} aria-label={`查看待办：${row.title}`} className="min-h-11 w-full break-words text-left text-sm text-ink">{row.title}<span className="mt-1 block text-xs text-sub">{row.date ?? '未安排日期'}{row.time ? ` ${row.time}` : ''}{row.priority && row.priority !== 'normal' ? row.priority === 'urgent' ? ' · 紧急' : ' · 重要' : ''}{row.recurring ? ' · 重复待办' : ''}</span></button>
              {row.currentStepProgress && <div className="mt-2 space-y-2 text-xs text-sub">
                <p>当前步骤 {row.currentStepProgress.completed}/{row.currentStepProgress.total}</p>
                {group.state !== 'completed-that-day' && (remaining.length ? <><p className="break-words text-ink">下一步可先做：{remaining[0].title}</p><p className="break-words">{remaining.slice(1, 3).map(step => step.title).join('、')}{row.currentStepProgress.total - row.currentStepProgress.completed > 3 ? ' · 其余步骤见待办' : ''}</p></> : <p>{row.currentStepProgress.completed === row.currentStepProgress.total ? '步骤已勾完，整件待办仍未标记完成。' : '其余步骤请打开待办查看。'}</p>)}
              </div>}
              {row.recurring && <p className="mt-2 text-xs text-sub">按本次日期状态整理，不把整个系列的步骤当作当天完成。</p>}
            </div>;
          })}
          {all.length > 8 && <button type="button" onClick={() => setExpanded(value => value.includes(group.state) ? value.filter(state => state !== group.state) : [...value, group.state])} className="min-h-11 w-full text-xs text-gene-purple">{expanded.includes(group.state) ? '收起其余事项' : `查看其余${all.length - 8}项`}</button>}
        </section>;
      })}
    </div>
  </details>;
}
