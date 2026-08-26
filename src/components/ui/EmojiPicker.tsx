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
    <div className="w-72 max-h-72 overflow-y-auto rounded-xl border border-line-strong bg-surface shadow-xl p-2">
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label} className="mb-2">
          <p className="px-1 py-0.5 text-[10px] text-gray-500">{group.label}</p>
          <div className="grid grid-cols-8 gap-0.5">
            {group.emojis.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onSelect(e)}
                className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-gene-purple/15 transition-colors"
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
