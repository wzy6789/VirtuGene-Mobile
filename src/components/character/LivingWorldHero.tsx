import { avatarImageSrc } from '../../lib/avatar';
import type { Character } from '../../db/index';

type LifeState = { affinity: number; mood: number; updatedAt: number; lifeFocus?: string };

export function LivingWorldHero({
  characters,
  states,
  onCreate,
  onOpenNetwork,
}: {
  characters: Character[];
  states: Record<string, LifeState>;
  onCreate: () => void;
  onOpenNetwork: () => void;
}) {
  const active = characters
    .map((character) => ({ character, state: states[character.id] }))
    .filter((item) => item.state)
    .sort((a, b) => (b.state?.updatedAt ?? 0) - (a.state?.updatedAt ?? 0));
  const brightest = active.filter((item) => (item.state?.mood ?? 0) >= 70).length;
  const latest = active[0];
  const stars = characters.slice(0, 5);

  return (
    <section className="vg-world-hero mx-3 mt-3 overflow-hidden rounded-[28px] border border-line bg-panel">
      <div className="relative min-h-[206px] px-5 pt-5 pb-4 overflow-hidden">
        <div className="absolute inset-0 vg-world-hero-atmosphere" />
        <div className="absolute -right-8 top-5 h-40 w-40 rounded-full border border-life-cyan/20" />
        <div className="absolute -right-1 top-[45px] h-20 w-20 rounded-full border border-gene-purple/35" />
        <div className="absolute right-8 top-[78px] h-2 w-2 rounded-full bg-life-cyan shadow-[0_0_18px_5px_rgba(0,206,201,.45)]" />
        {stars.map((character, index) => {
          const x = [70, 84, 62, 90, 74][index];
          const y = [34, 58, 72, 82, 20][index];
          return <span key={character.id} className="absolute z-10 h-7 w-7 overflow-hidden rounded-full border border-white/30 bg-panel shadow-[0_0_18px_rgba(108,92,231,.4)]" style={{ left: `${x}%`, top: `${y}%` }}>{avatarImageSrc(character.avatar) ? <img src={avatarImageSrc(character.avatar)} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-sm">{character.avatar}</span>}</span>;
        })}

        <div className="vg-world-hero-copy relative z-10">
          <div className="flex items-center gap-2 text-[12px] tracking-[0.18em] text-[color:var(--vg-cyan)]"><span className="h-1.5 w-1.5 rounded-full bg-life-cyan shadow-[0_0_8px_#00CEC9]" />VIRTUGENE / LIVING WORLD</div>
          <h2 className="mt-3 text-[28px] font-semibold leading-[1.45] tracking-[0.04em] text-ink">让数字灵魂<br /><span className="bg-gradient-to-r from-[var(--vg-accent)] to-[var(--vg-cyan)] bg-clip-text text-transparent">拥有时间。</span></h2>
          <p className="mt-3 text-[12px] leading-relaxed text-sub">{latest?.state?.lifeFocus || (characters.length ? '从一次对话开始，角色会记住、改变，也会彼此相遇。' : '创造第一个数字角色，让你的世界从这里开始。')}</p>
        </div>

        <div className="relative z-10 mt-5 flex flex-wrap items-center gap-2">
          <button onClick={onCreate} className="vg-button vg-button-primary">创造角色</button>
          <button onClick={onOpenNetwork} className="vg-button vg-button-secondary">进入关系网络</button>
        </div>
      </div>

      <div className="relative grid grid-cols-3 border-t border-line bg-surface px-2 py-3">
        <Metric label="生命体" value={characters.length} accent="text-ink" />
        <Metric label="状态明亮" value={brightest} accent="text-[color:var(--vg-cyan)]" />
        <Metric label="共同连接" value={active.filter((item) => (item.state?.affinity ?? 0) > 0).length} accent="text-[color:var(--vg-accent)]" />
      </div>
    </section>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent: string }) {
  return <div className="border-r border-line last:border-r-0 px-2 text-center"><span className={`block text-base font-semibold tabular-nums ${accent}`}>{value}</span><span className="mt-0.5 block text-[12px] text-sub">{label}</span></div>;
}
