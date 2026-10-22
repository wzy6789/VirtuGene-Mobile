import { useMemo } from 'react';
import type { Character, Message } from '../../db';
import type { ChatBackgroundConfig } from '../../lib/chat-background-config';
import { ChatBackgroundLayer } from '../chat/ChatBackgroundLayer';
import { MessageBubble } from '../chat/MessageBubble';
import { backgroundStyle } from '../chat/useChatAtmosphere';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { SoulOrb } from '../ui/SoulOrb';

interface Props {
  character?: Character;
  userId: string;
  config: ChatBackgroundConfig;
  draftBlob?: Blob;
  keyboard?: boolean;
  longReply?: boolean;
}

/** Render the production reading components without loading a conversation,
 * writing messages, or exposing their contextual actions. The fixed examples
 * never enter persistence or a model request. */
export function CharacterStylePreview({ character, userId, config, draftBlob, keyboard = false, longReply = false }: Props) {
  const avatar=config.roleVisual?.avatar?.image||character?.avatar||'TA';
  const messages = useMemo<Message[]>(() => [
    { id: 'style-preview-role', sessionId: 'style-preview-only', role: 'assistant', content: '清晰的对话，始终在这里。', createdAt: 0, isProactive: false },
    { id: 'style-preview-user', sessionId: 'style-preview-only', role: 'user', content: '我们慢慢聊。', createdAt: 0, isProactive: false },
    ...(longReply ? [{ id: 'style-preview-long', sessionId: 'style-preview-only', role: 'assistant' as const, content: "长文字也要读得舒服。\n\n[示例链接](https://example.invalid/)\n\n```js\nconst sky = 'quiet';\n```\n\n" + '不急着说完，我会把你的话认真听下去。'.repeat(3), createdAt: 0, isProactive: false }] : []),
  ], [longReply]);
  return <section className="vg-chat-atmosphere vg-background-preview" data-chat-motion={config.strength} data-chat-phase="idle" data-chat-resting={keyboard ? true : undefined} style={backgroundStyle(config)} aria-label="聊天外观隔离预览">
    <ChatBackgroundLayer config={config} userId={userId} draftBlob={draftBlob} />
    <div className="vg-background-preview-content">
      <header><span className="flex items-center gap-2 min-w-0"><Avatar avatar={avatar} size="sm" /><strong className="truncate">{character?.name || '聊天预览'}</strong></span><SoulOrb size={32} animated motionOverride={config.roleVisual?.orbMotion} colorOverride={config.roleVisual?.orbColor} emotion="idle" motionContext="reading" /></header>
      <div className="w-full" role="img" aria-label="本地气泡样式示例：清晰的对话，始终在这里。我们慢慢聊。">
        <div inert>{messages.map(message => <MessageBubble key={message.id} message={message} avatar={message.role === 'assistant' ? avatar : '你'} animate={false} />)}</div>
      </div>
      <div className="vg-background-preview-input" aria-hidden="true">输入消息…<Icon name="send" size={17} /></div>
      <small>本地预览，不发送消息</small>
      {keyboard && <div className="vg-background-preview-keyboard" aria-label="键盘占位模拟">键盘预览 · 不唤起系统键盘</div>}
    </div>
  </section>;
}
