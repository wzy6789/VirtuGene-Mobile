import { useAuthStore } from '../../store/auth-store';
import { Modal } from '../ui/Modal';
import { GeneGlyph } from '../ui/GeneGlyph';
import { useEffect, useRef, useState } from 'react';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { useChatStore } from '../../store/chat-store';
import { fuseSouls, type FusionResult } from '../../lib/ai/fusion';
import { avatarImageSrc } from '../../lib/avatar';
import { ensureOwnedChatCharacter } from '../../lib/character-chat';
import type { Character } from '../../db/index';
import '../../styles/gene-library.css';

interface FusionModalProps {
  onClose: () => void;
  onSaved?: (character: Character) => void;
  sourceCharacters?: Character[];
}

/** An account change invalidates the whole draft and every pending response. */
export function FusionModal({ onClose, onSaved, sourceCharacters }: FusionModalProps) {
  const owner = useAuthStore((state) => state.userId);
  const initialOwner = useRef(owner);
  const valid = !!owner && initialOwner.current === owner;
  useEffect(() => { if (!valid) onClose(); }, [valid, onClose]);
  return valid ? <FusionContent key={owner} onClose={onClose} onSaved={onSaved} sourceCharacters={sourceCharacters} /> : null;
}

function FusionContent({ onClose, onSaved, sourceCharacters }: FusionModalProps) {
  const userId = useAuthStore((state) => state.userId);
  const available = useChatStore((state) => state.characters);
  const createCharacter = useChatStore((state) => state.createCharacter);
  const characters = (sourceCharacters ?? available).filter((character) => character.agentProfile !== 'secretary' && (character.isPreset || character.published || character.createdBy === userId));
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [fusing, setFusing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FusionResult | null>(null);
  const [name, setName] = useState('');
  const [signature, setSignature] = useState('');
  const [greeting, setGreeting] = useState('');
  const [prompt, setPrompt] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState<Character | null>(null);
  const [opening, setOpening] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.userId === previous.userId) return;
      mounted.current = false;
      requestVersion.current += 1;
      onCloseRef.current();
    });
    return () => { unsubscribe(); mounted.current = false; requestVersion.current += 1; };
  }, []);
  const current = () => mounted.current && !!userId && useAuthStore.getState().userId === userId;

  const a = characters.find((character) => character.id === aId);
  const b = characters.find((character) => character.id === bId);
  const busy = fusing || creating || opening;
  const canFuse = !!a && !!b && a.id !== b.id;

  const close = () => {
    // Persistence has no abort contract; wait for its known outcome before leaving.
    if (creating || opening || lock.current && !fusing) return;
    mounted.current = false;
    requestVersion.current += 1;
    onClose();
  };

  const handleFuse = async () => {
    if (!a || !b || a.id === b.id || lock.current || saved || !current()) return;
    lock.current = true;
    const request = ++requestVersion.current;
    setFusing(true);
    setError(null);
    try {
      const response = await fuseSouls(
        { name: a.name, systemPrompt: a.systemPrompt, tags: a.tags },
        { name: b.name, systemPrompt: b.systemPrompt, tags: b.tags },
      );
      if (!current() || request !== requestVersion.current) return;
      if (!response.data) {
        setError(response.error === 'fusion:invalid' ? '生成的角色资料不完整，请重试。' : result ? '重新生成失败，原来的编辑稿已保留。' : '预览生成失败，所选角色已保留，请重试。');
        return;
      }
      setResult(response.data);
      setName(response.data.name ?? '');
      setSignature(response.data.signature);
      setGreeting(response.data.greeting);
      setPrompt(response.data.systemPrompt);
      setTagsText(response.data.tags.join('、'));
    } catch {
      if (current() && request === requestVersion.current) setError(result ? '重新生成失败，原来的编辑稿已保留。' : '预览生成失败，请重试。');
    } finally {
      if (request === requestVersion.current) {
        lock.current = false;
        if (current()) setFusing(false);
      }
    }
  };

  const handleCreate = async () => {
    if (lock.current || !result || saved || !current()) return;
    const finalName = name.trim();
    if (finalName.length < 2) { setError('请为新角色取一个名字（至少 2 个字）。'); return; }
    if (!prompt.trim()) { setError('请补充新角色的完整设定。'); return; }
    lock.current = true;
    setCreating(true);
    setError(null);
    try {
      const character = await createCharacter({
        name: finalName,
        avatar: '✨',
        systemPrompt: prompt.trim(),
        tags: [...new Set(tagsText.split(/[、,，\s]+/).filter(Boolean))].slice(0, 5),
        signature: signature.trim(),
        greeting: greeting.trim(),
        isPreset: false,
        isCustom: true,
        published: false,
        createdBy: userId ?? '',
      }, { deferActivation: true });
      if (!current()) return;
      // The durable ID is recorded before refresh, so a refresh error cannot
      // expose a second create action for the same saved draft.
      setSaved(character);
      onSaved?.(character);
      try {
        await useChatStore.getState().loadCharacters();
      } catch {
        if (current()) setError('角色已保存，角色列表暂未刷新。可以稍后重新打开基因库。');
      }
    } catch {
      if (current()) setError('保存失败，编辑稿已保留，请重试。');
    } finally {
      lock.current = false;
      if (current()) setCreating(false);
    }
  };

  const startChat = async () => {
    if (!saved || lock.current || !current() || !userId) return;
    lock.current = true;
    setOpening(true);
    setError(null);
    try {
      const target = await ensureOwnedChatCharacter(saved, userId);
      if (!current()) return;
      await useChatStore.getState().selectCharacter(target.id);
      if (!current()) return;
      mounted.current = false;
      onClose();
    } catch {
      if (current()) setError('角色已保存，但聊天暂时无法打开，请重试。');
    } finally {
      lock.current = false;
      if (current()) setOpening(false);
    }
  };

  return <Modal open mobileFullHeight onClose={close} title="融合角色" panelClassName="vg-fusion-modal" canSnapshotOnExit={() => false}
    footer={<div className="vg-fusion-footer">
      {saved ? <><button type="button" className="vg-button vg-button-secondary" onClick={close} disabled={busy}>完成</button><button type="button" className="vg-button vg-button-primary" onClick={startChat} disabled={busy}>{opening ? '正在打开…' : '开始聊天'}</button></>
        : result ? <><button type="button" className="vg-button vg-button-secondary" onClick={handleFuse} disabled={busy || !canFuse}>{fusing ? '正在重新生成…' : '重新生成'}</button><button type="button" className="vg-button vg-button-primary" onClick={handleCreate} disabled={busy}>{creating ? '正在保存…' : '保存新角色'}</button></>
        : <button type="button" className="vg-button vg-button-primary" onClick={handleFuse} disabled={busy || !canFuse}><GeneGlyph size={18} />{fusing ? '正在生成预览…' : '生成预览'}</button>}
    </div>}
  >
    <div className="vg-fusion-content" aria-busy={busy}>
      <ol className="vg-fusion-steps" aria-label="融合步骤">
        {['选择两位角色', '编辑预览', '保存新角色'].map((label, index) => <li key={label} aria-current={(saved ? 2 : result ? 1 : 0) === index ? 'step' : undefined}><span aria-hidden="true">{index + 1}</span>{label}</li>)}
      </ol>
      {saved ? <div className="vg-fusion-success">
        <div className="vg-fusion-new-portrait" aria-hidden="true">✨</div>
        <h3>{saved.name}已保存</h3>
        {saved.signature && <p>{saved.signature}</p>}
        <span>新角色已加入“我的”，随时可以开始聊天。</span>
      </div> : <>
        <p className="vg-fusion-intro">选择两位角色，生成一个新的可编辑角色。确认预览后再保存。</p>
        <fieldset className="vg-fusion-sources" disabled={busy || !!result}>
          {[
            { label: '基因 A', id: 'fusion-a', value: aId, set: setAId, source: a, otherId: bId },
            { label: '基因 B', id: 'fusion-b', value: bId, set: setBId, source: b, otherId: aId },
          ].map(({ label, id, value, set, source, otherId }) => <div className="vg-fusion-source" key={id}>
            <label htmlFor={id}>{label}</label>
            <span className="vg-fusion-source-portrait" aria-hidden="true">{avatarImageSrc(source?.avatar) ? <img src={avatarImageSrc(source?.avatar)} alt="" /> : source?.avatar || <GeneGlyph size={28} />}</span>
            <select id={id} value={value} onChange={(event) => { set(event.target.value); setError(null); }}>
              <option value="">选择角色…</option>
              {characters.filter((character) => character.id !== otherId).map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
            </select>
            {source?.signature && <p>{source.signature}</p>}
          </div>)}
        </fieldset>
        {characters.length < 2 && <FeedbackNotice message="需要两位不同的角色才能融合。请先在基因库添加角色，或创建自己的角色。" />}
        {fusing && <div className="vg-fusion-wait" role="status"><span className="vg-fusion-request-dot" aria-hidden="true" /><span>正在请求生成预览…{result ? '完成后将替换当前编辑稿。' : '你可以取消并返回基因库。'}</span></div>}
        {result && <fieldset className="vg-fusion-editor" disabled={busy}>
          <legend>角色预览</legend>
          <p className="vg-fusion-draft-note">当前为未保存的草稿。重新生成成功后会替换下面的编辑内容。</p>
          <label htmlFor="fusion-name">名字</label>
          <input id="fusion-name" className="vg-text-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="新角色的名字" />
          <label htmlFor="fusion-signature">一句话签名</label>
          <input id="fusion-signature" className="vg-text-field" value={signature} onChange={(event) => setSignature(event.target.value)} />
          <label htmlFor="fusion-greeting">开场白</label>
          <textarea id="fusion-greeting" className="vg-text-field" value={greeting} onChange={(event) => setGreeting(event.target.value)} rows={3} />
          <label htmlFor="fusion-tags">标签（最多 5 个，顿号分隔）</label>
          <input id="fusion-tags" className="vg-text-field" value={tagsText} onChange={(event) => setTagsText(event.target.value)} />
          <details className="vg-fusion-advanced">
            <summary>完整设定<span>可展开编辑</span></summary>
            <label htmlFor="fusion-prompt">角色的完整设定</label>
            <textarea id="fusion-prompt" className="vg-text-field" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={10} />
          </details>
        </fieldset>}
      </>}
      {error && <FeedbackNotice tone="error" message={error} />}
    </div>
  </Modal>;
}
