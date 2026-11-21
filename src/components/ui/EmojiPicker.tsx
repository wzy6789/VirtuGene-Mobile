const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: '表情',
    emojis: [
      '😀', '😄', '😁', '😊', '🙂', '😉', '😍', '🥰', '😘', '😋',
      '😎', '🤩', '🥳', '😏', '😌', '😴', '🤔', '🤨', '😐', '😶',
      '🙄', '😬', '😅', '😂', '🤣', '😭', '😢', '😡', '😤', '🤯',
      '😱', '😨', '😰', '🥺', '😇', '🤗', '🤭', '🤫', '😷', '🤠',
      '🥴', '😵', '😈', '👻', '💀', '🤖', '👽', '🫶',
    ],
  },
  {
    label: '人物',
    emojis: [
      '👶', '🧒', '👦', '👧', '🧑', '👨', '👩', '🧓', '👴', '👵',
      '🙋', '💁', '🙆', '🙅', '🤷', '💃', '🕺', '🧑‍🎓', '👨‍💻', '👩‍🎨',
      '🧑‍🚀', '🦸', '🧙', '🧚', '🧜', '🧛', '🧟', '👤',
    ],
  },
  {
    label: '动物',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
      '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦆', '🦉',
      '🐴', '🦄', '🐝', '🦋', '🐢', '🐍', '🦖', '🦕', '🐳', '🐬',
      '🐙', '🦀', '🐠', '🦈', '🐊',
    ],
  },
  {
    label: '自然',
    emojis: [
      '🌸', '🌺', '🌹', '🌻', '🌼', '🌷', '🌵', '🌲', '🌳', '🍀',
      '☘️', '🌿', '🍁', '🍂', '🌊', '🔥', '✨', '⭐', '🌟', '🌈',
      '☀️', '🌙', '☁️', '⛈️', '❄️', '🌌', '🌠', '🪐', '🌍', '💫',
    ],
  },
  {
    label: '食物',
    emojis: [
      '🍎', '🍊', '🍋', '🍇', '🍉', '🍓', '🍑', '🍒', '🥝', '🍍',
      '🥥', '🥑', '🍅', '🌽', '🥕', '🍞', '🧀', '🍔', '🍟', '🍕',
      '🌭', '🍜', '🍣', '🍰', '🎂', '🍪', '🍫', '🍬', '🍭', '☕',
      '🍵', '🍺',
    ],
  },
  {
    label: '活动',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🏸', '🥊',
      '🎮', '🎲', '🎸', '🎹', '🎻', '🎨', '🎬', '🎤', '🎧', '📷',
      '✈️', '🚗', '🚀', '🛸', '🏠', '⛺', '🎡', '🎢', '🎪',
    ],
  },
  {
    label: '物品',
    emojis: [
      '💻', '📱', '⌚', '📚', '📝', '✏️', '💡', '🔦', '🔑', '🔒',
      '💎', '💰', '💳', '🎁', '🎈', '🎀', '🧸', '🛏️', '🚪', '🧭',
      '🔭', '🔬', '🧪', '🧬', '🧲', '📦', '🗝️', '🖼️',
    ],
  },
  {
    label: '符号',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '💘',
      '💝', '💯', '✅', '❌', '⚠️', '❓', '❗', '♾️', '⚡', '💢',
      '👍', '👎', '👏', '🙏', '🤝', '✌️', '🖖', '🤘',
    ],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  return (
    <div className="w-full max-w-sm max-h-[60vh] overflow-y-auto rounded-xl border border-line-strong bg-surface p-2">
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label} className="mb-2">
          <p className="px-1 py-2 text-xs font-medium text-sub">{group.label}</p>
          <div className="grid gap-1" style={{gridTemplateColumns:'repeat(auto-fit,minmax(44px,1fr))'}}>
            {group.emojis.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`使用 ${e} 作为头像`}
                onClick={() => onSelect(e)}
                className="w-full min-h-11 flex items-center justify-center text-xl rounded-lg hover:bg-surface-strong transition-colors"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
