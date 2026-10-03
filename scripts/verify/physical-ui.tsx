import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MultiFilterChips, TagInput, PERSONALITY_TAGS, PressLightCard } from '../../src/components/ui/PhysicalInteractions';
import { ChatInput } from '../../src/components/chat/ChatInput';
import { MessageBubble } from '../../src/components/chat/MessageBubble';
import { useSettingsStore } from '../../src/store/settings-store';
import type { Message } from '../../src/db/index';

declare global { interface Window { physicalResults: { messages: string[]; voices: unknown[]; images: number }; voiceMock: { permissionDelay: number; startDelay: number; granted: boolean; starts: number; cancels: number; stops: number }; } }
window.physicalResults = { messages: [], voices: [], images: 0 };
window.voiceMock = { permissionDelay: 0, startDelay: 0, granted: true, starts: 0, cancels: 0, stops: 0 };
function Fixture() {
  const [filters,setFilters] = useState<string[]>([]);
  const [tags,setTags] = useState(['温柔','细心','可靠','幽默','坦率','冷静']);
  const [clicked,setClicked] = useState(0);
  const [composerKey,setComposerKey] = useState(0);
  const size = useSettingsStore(s=>s.chatFontSize);
  return <main className="mobile-layout" style={{maxWidth:430,margin:'0 auto',padding:16,minHeight:'100dvh'}}>
    <h1 style={{fontSize:22,marginBottom:16}}>VirtuGene · 交互验收</h1>
    <MultiFilterChips options={PERSONALITY_TAGS} value={filters} onChange={setFilters} />
    <output id="selected">{JSON.stringify(filters)}</output>
    <h2 style={{margin:'20px 0 12px'}}>人物标签</h2>
    <TagInput value={tags} onChange={setTags} suggestions={PERSONALITY_TAGS} label="性格标签" />
    <output id="tags" style={{display:'none'}}>{JSON.stringify(tags)}</output>
    <nav className="vg-world-life-entries" style={{margin:'20px 0'}}>
      <PressLightCard className="vg-world-life-entry is-diary" onClick={()=>setClicked(v=>v+1)}><strong>日记</strong><span>留下今天的故事</span></PressLightCard>
      <PressLightCard className="vg-world-life-entry is-stage"><strong>星域</strong><span>进入新的世界</span></PressLightCard>
    </nav>
    <output id="card-clicks">{clicked}</output>
    <MessageBubble avatar="🧬" message={{id:'ui-test',sessionId:'test',role:'assistant',content:'我刚好也想和你说这件事。',createdAt:Date.now(),isProactive:false} as Message} />
    <output id="font-size">{size}</output>
    <ChatInput key={composerKey} onSend={t=>window.physicalResults.messages.push(t)} onSendVoice={v=>window.physicalResults.voices.push(v)} onSendImage={()=>window.physicalResults.images++} />
    <button id="remount-composer" style={{display:'none'}} onClick={()=>setComposerKey(v=>v+1)}>Remount</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
