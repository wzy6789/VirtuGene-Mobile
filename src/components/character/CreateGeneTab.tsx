import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { EmojiPicker } from '../ui/EmojiPicker';
import { ipc } from '../../lib/ipc-client';
import { stateRepo } from '../../db/state-repo';
import { memoryRepo } from '../../db/memory-repo';
import type { Character } from '../../db/index';

interface CreateGeneTabProps {
  editCharacter?: Character;
  onClose: () => void;
}

const ERROR_MAP: Record<string, string> = {
  'auth:invalid_key': '基因序列验证失败，请检查 API Key',
  'billing:insufficient': 'DeepSeek 账户余额不足，请前往平台充值',
  'rate:limited': '请求过于频繁，请稍后重试',
  'server:error': '基因链接中断，请重试',
};

interface Candidate {
  tags: string[];
  signature: string;
  greeting: string;
  systemPrompt: string;
}

const STEP_FIELDS = [
  { key: 'identity', title: '身份与世界观', placeholder: 'TA 是谁？来自怎样的世界？（如：一位穿梭星际的旅人）' },
  { key: 'personality', title: '性格', placeholder: 'TA 的性格特质、情感倾向（如：开朗、好奇、偶尔毒舌）' },
  { key: 'speechStyle', title: '说话风格', placeholder: 'TA 怎么说话？口头禅、语气、句式（如：喜欢用星空比喻情感）' },
  { key: 'speechExamples', title: '说话示例', placeholder: '给 1-2 句 TA 会说的话作为参考' },
  { key: 'boundaries', title: '互动边界', placeholder: 'TA 不应该做什么？哪些话题要谨慎？（如：尊重现实关系，不诱导依赖）' },
  { key: 'supplement', title: '补充', placeholder: '其他任何想让 TA 记住的设定' },
] as const;

type FieldKey = (typeof STEP_FIELDS)[number]['key'];

const RELATIONSHIP_PRESETS = [
  { label: '同伴', description: '彼此信任，在关键时刻会并肩行动。' },
  { label: '家人', description: '有天然的牵挂与长期形成的默契。' },
  { label: '宿敌', description: '彼此较劲，却认可对方的能力与存在。' },
  { label: '恋人', description: '有明确的在意、亲密与相互尊重。' },
  { label: '师徒', description: '一方引导，一方学习，也会在成长中重新理解彼此。' },
  { label: '旧识', description: '共享一段过去，对彼此有未说尽的了解。' },
] as const;

export function CreateGeneTab({ editCharacter, onClose }: CreateGeneTabProps) {
  const isEdit = !!editCharacter;
  const apiKey = useAuthStore((s) => s.apiKey);
  const userId = useAuthStore((s) => s.userId) ?? '';
  const existingCharacters = useChatStore((s) => s.characters);
  const createCharacter = useChatStore((s) => s.createCharacter);
  const updateCharacter = useChatStore((s) => s.updateCharacter);

  const [name, setName] = useState(editCharacter?.name ?? '');
  const [avatar, setAvatar] = useState(editCharacter?.avatar ?? '🧬');
  const [systemPrompt, setSystemPrompt] = useState(editCharacter?.systemPrompt ?? '');
  const [tags, setTags] = useState<string[]>(editCharacter?.tags ?? []);
  const [signature, setSignature] = useState(editCharacter?.signature ?? '');
  const [greeting, setGreeting] = useState(editCharacter?.greeting ?? '');
  const [catchphrase, setCatchphrase] = useState(editCharacter?.catchphrase ?? '');
  const [boundaries, setBoundaries] = useState(editCharacter?.boundaries ?? '');
  const [tagInput, setTagInput] = useState('');
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [published, setPublished] = useState(editCharacter?.published ?? false);
  const [relationshipTargets, setRelationshipTargets] = useState<string[]>([]);
  const [relationshipMeta, setRelationshipMeta] = useState<Record<string, { label: string; description: string }>>({});
  /** 默认关闭：新角色不会在未经用户确认时继承既有聊天中的内容。 */
  const [importUserMemories, setImportUserMemories] = useState(false);
  const [importableMemoryCount, setImportableMemoryCount] = useState(0);

  const [fields, setFields] = useState<Record<FieldKey, string>>({
    identity: '',
    personality: '',
    speechStyle: '',
    speechExamples: '',
    boundaries: '',
    supplement: '',
  });
  const [mode, setMode] = useState<'simple' | 'guided'>('guided');
  const [description, setDescription] = useState('');
  const [openSections, setOpenSections] = useState<Record<FieldKey, boolean>>({
    identity: true,
    personality: false,
    speechStyle: false,
    speechExamples: false,
    boundaries: false,
    supplement: false,
  });

  // File import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<{ name: string; path: string } | null>(null);
  const [documentText, setDocumentText] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showFilePreview, setShowFilePreview] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [avatarDragOver, setAvatarDragOver] = useState(false);
  const [parserMissing, setParserMissing] = useState(false);
  const [isDownloadingParser, setIsDownloadingParser] = useState(false);
  const pendingFileRef = useRef<File | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{ step: string; message: string; progress: number } | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!editCharacter || !userId) return;
    let alive = true;
    void stateRepo.get(editCharacter.id, userId).then((state) => {
      if (!alive || !state) return;
      const links = state.storyRelations ?? [];
      setRelationshipTargets(links.map((link) => link.targetCharacterId));
      setRelationshipMeta(Object.fromEntries(links.map((link) => [link.targetCharacterId, {
        label: link.label,
        description: link.description ?? '',
      }])));
    });
    return () => { alive = false; };
  }, [editCharacter, userId]);

  useEffect(() => {
    if (isEdit || !userId) return;
    let alive = true;
    void memoryRepo.getRecentByUser(userId, 36).then((items) => {
      if (!alive) return;
      const unique = new Set(items.map((item) => item.content.trim()).filter(Boolean));
      setImportableMemoryCount(Math.min(12, unique.size));
    });
    return () => { alive = false; };
  }, [isEdit, userId]);

  const filledCount = STEP_FIELDS.filter((f) => fields[f.key].trim().length > 0).length;
  const canGenerate = name.trim().length >= 2 && !isEdit && (
    mode === 'simple' ? description.trim().length > 0 : filledCount > 0
  );
  const canSave = name.trim().length >= 2 && systemPrompt.trim().length > 0;

  const setField = (key: FieldKey, value: string) => setFields((f) => ({ ...f, [key]: value }));
  const toggleSection = (key: FieldKey) => setOpenSections((o) => ({ ...o, [key]: !o[key] }));

  const processFile = async (file: File) => {
    pendingFileRef.current = file;
    setSelectedFile({ name: file.name, path: file.name });
    setIsParsing(true);
    setParseError(null);
    setParserMissing(false);
    setDocumentText(null);

    const result = await ipc.file.parse(file);
    setIsParsing(false);

    if (result.error === 'parser:missing') {
      setParserMissing(true);
    } else if (result.error) {
      setParseError(result.error);
    } else if (result.text) {
      setDocumentText(result.text);
    }
  };

  const handleDownloadParser = async () => {
    setIsDownloadingParser(true);
    const result = await ipc.file.downloadParser();
    setIsDownloadingParser(false);

    if (result.error) {
      setParseError(result.error);
      return;
    }
    setParserMissing(false);
    const file = pendingFileRef.current;
    if (file) await processFile(file);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const readImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAvatar(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageFile(file);
    e.target.value = '';
  };

  const handleAvatarDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAvatarDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readImageFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext ?? '')) {
      setParseError(`不支持的文件格式: .${ext}`);
      return;
    }

    await processFile(file);
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsGenerating(true);
    setGenerationError(null);
    setGenerationProgress(null);
    setCandidates(null);

    const genFields = mode === 'simple' ? { description: description.trim() } : fields;
    const result = await ipc.character.generate(
      {
        apiKey: apiKey ?? '',
        characterName: name.trim(),
        fields: genFields,
        enableWebSearch,
        documentContext: documentText ?? undefined,
        count: 3,
      },
      (step, message, progress) => setGenerationProgress({ step, message, progress }),
    );

    setIsGenerating(false);
    setGenerationProgress(null);

    if (result.error) {
      setGenerationError(ERROR_MAP[result.error] ?? ERROR_MAP['server:error']);
    } else if (result.candidates && result.candidates.length > 0) {
      setCandidates(result.candidates);
    }
  };

  const handlePickCandidate = (c: Candidate) => {
    setTags(c.tags);
    setSignature(c.signature);
    setGreeting(c.greeting);
    setSystemPrompt(c.systemPrompt);
    setBoundaries((current) => current || fields.boundaries.trim());
    setCandidates(null);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    setTagInput('');
    if (!tags.includes(t)) setTags([...tags, t]);
  };

  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  const handleSave = async () => {
    if (!canSave) return;
    setNameError(null);

    if (name.trim().length < 2) {
      setNameError('请为数字灵魂命名为');
      return;
    }

    setIsSaving(true);
    const finalSystemPrompt = [
      systemPrompt.trim(),
      boundaries.trim() ? `\n[互动边界]\n${boundaries.trim()}` : '',
    ].filter(Boolean).join('\n');

    if (isEdit) {
      await updateCharacter(editCharacter.id, {
        name: name.trim(),
        avatar,
        systemPrompt: finalSystemPrompt,
        tags,
        signature: signature.trim(),
        greeting: greeting.trim(),
        catchphrase: catchphrase.trim() || undefined,
        boundaries: boundaries.trim() || undefined,
        published,
      });
      await stateRepo.replaceStoryRelations(editCharacter.id, userId, relationshipTargets.map((characterId) => ({
        characterId,
        label: relationshipMeta[characterId]?.label ?? '故事关联',
        description: relationshipMeta[characterId]?.description ?? '',
      })));
    } else {
      const created = await createCharacter({
        name: name.trim(),
        avatar,
        systemPrompt: finalSystemPrompt,
        tags,
        signature: signature.trim(),
        greeting: greeting.trim(),
        catchphrase: catchphrase.trim() || undefined,
        boundaries: boundaries.trim() || undefined,
        isPreset: false,
        isCustom: true,
        published,
        createdBy: '',
      });
      if (importUserMemories) {
        await memoryRepo.importRecentUserMemories(created.id, userId);
      }
      await stateRepo.replaceStoryRelations(created.id, userId, relationshipTargets.map((characterId) => ({
        characterId,
        label: relationshipMeta[characterId]?.label ?? '故事关联',
        description: relationshipMeta[characterId]?.description ?? '',
      })));
    }

    setIsSaving(false);
    onClose();
  };

  return (
    <div className="space-y-5">
      {/* Name */}
      <div>
        <label className="block text-sm text-gray-400 mb-1.5">姓名</label>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          placeholder="为数字灵魂命名"
          className={`w-full px-4 py-3 bg-surface border rounded-xl text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors ${
            nameError ? 'border-red-500/50' : 'border-line-strong'
          }`}
        />
        {nameError && <p className="mt-1 text-xs text-red-400">{nameError}</p>}
      </div>

      {/* Avatar: emoji + image upload */}
      <div>
        <label className="block text-sm text-gray-400 mb-1.5">头像</label>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setAvatarDragOver(true); }}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setAvatarDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setAvatarDragOver(false); }}
              onDrop={handleAvatarDrop}
              className={`w-14 h-14 flex items-center justify-center text-3xl rounded-xl border transition-colors overflow-hidden ${
                avatarDragOver
                  ? 'border-gene-purple bg-gene-purple/20'
                  : 'border-line-strong bg-surface hover:bg-surface-strong'
              }`}
            >
              {avatar.startsWith('data:') ? (
                <img src={avatar} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                avatar
              )}
            </button>
            {showEmojiPicker && (
              <div className="absolute top-full mt-2 z-20">
                <EmojiPicker
                  onSelect={(emoji) => {
                    setAvatar(emoji);
                    setShowEmojiPicker(false);
                  }}
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="px-3 py-1.5 rounded-lg bg-surface border border-line-strong text-xs text-sub hover:bg-surface-strong transition-colors"
          >
            {avatar.startsWith('data:') ? '更换图片' : '上传图片'}
          </button>
        </div>
      </div>

      {!isEdit && (
        <section className="rounded-2xl border border-gene-purple/20 bg-gene-purple/[0.05] px-4 py-3.5">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={importUserMemories}
              disabled={importableMemoryCount === 0}
              onChange={(event) => setImportUserMemories(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-line-strong bg-surface text-gene-purple focus:ring-gene-purple/30 disabled:opacity-40"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">带上我已分享过的记忆</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-gray-500">
                {importableMemoryCount > 0
                  ? `导入最多 ${importableMemoryCount} 条关于你的记忆摘要；不会导入原始聊天记录。`
                  : '还没有可导入的记忆。以后聊天沉淀下来的内容也仍由你决定是否分享。'}
              </span>
            </span>
          </label>
        </section>
      )}

      <section className="rounded-2xl border border-life-cyan/20 bg-gradient-to-br from-life-cyan/[0.07] to-gene-purple/[0.08] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] tracking-[0.18em] text-life-cyan">STORY RELATIONSHIPS</p>
            <h3 className="mt-1 text-sm font-semibold text-ink">把 TA 放进你的故事世界</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">设定的关系会直接出现在关系网络中；群聊和普通对话不会自动改变它。</p>
          </div>
          <span className="shrink-0 rounded-full bg-life-cyan/10 px-2 py-1 text-[10px] text-life-cyan">{relationshipTargets.length} 条连接</span>
        </div>

        {existingCharacters.filter((character) => character.id !== editCharacter?.id).length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-3 text-xs text-gray-500">创建更多角色后，就能在这里为他们设定同伴、宿敌、家人或任何你想要的故事关系。</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {existingCharacters.filter((character) => character.id !== editCharacter?.id).map((character) => {
              const selected = relationshipTargets.includes(character.id);
              return (
                <button
                  type="button"
                  key={character.id}
                  onClick={() => {
                    if (selected) {
                      setRelationshipTargets((current) => current.filter((id) => id !== character.id));
                      return;
                    }
                    setRelationshipTargets((current) => [...current, character.id]);
                    setRelationshipMeta((current) => ({ ...current, [character.id]: current[character.id] ?? { label: '故事关联', description: '' } }));
                  }}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors ${selected ? 'border-life-cyan/50 bg-life-cyan/12 text-life-cyan' : 'border-line bg-panel text-gray-500 hover:border-life-cyan/30'}`}
                >
                  <span className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-surface text-xs">{character.avatar.startsWith('data:') ? <img src={character.avatar} alt="" className="h-full w-full object-cover" /> : character.avatar}</span>
                  {character.name}
                </button>
              );
            })}
          </div>
        )}

        {relationshipTargets.length > 0 && (
          <div className="mt-3 space-y-2">
            {relationshipTargets.map((targetId) => {
              const target = existingCharacters.find((character) => character.id === targetId);
              if (!target) return null;
              const meta = relationshipMeta[targetId] ?? { label: '故事关联', description: '' };
              return (
                <div key={targetId} className="rounded-xl border border-line bg-panel/75 p-2.5">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-ink"><span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-lg bg-surface text-xs">{target.avatar.startsWith('data:') ? <img src={target.avatar} alt="" className="h-full w-full object-cover" /> : target.avatar}</span>{target.name}</div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {RELATIONSHIP_PRESETS.map((preset) => (
                      <button
                        type="button"
                        key={preset.label}
                        onClick={() => setRelationshipMeta((current) => ({
                          ...current,
                          [targetId]: { label: preset.label, description: meta.description || preset.description },
                        }))}
                        className={`rounded-full border px-2 py-1 text-[10px] transition-colors ${meta.label === preset.label ? 'border-life-cyan/50 bg-life-cyan/12 text-life-cyan' : 'border-line bg-surface text-gray-500 hover:border-life-cyan/35 hover:text-life-cyan'}`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input value={meta.label} onChange={(event) => setRelationshipMeta((current) => ({ ...current, [targetId]: { ...meta, label: event.target.value } }))} maxLength={18} placeholder="关系名称，例如：搭档" className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-xs text-ink outline-none focus:border-life-cyan/45" />
                    <input value={meta.description} onChange={(event) => setRelationshipMeta((current) => ({ ...current, [targetId]: { ...meta, description: event.target.value } }))} maxLength={100} placeholder="关系锚点：他们为何如此相处？" className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-xs text-ink outline-none focus:border-life-cyan/45" />
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-gray-500">关系锚点会保留在人物网络中，并在话题相关时成为两位角色理解彼此的共同背景。</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Create-mode input: toggle between simple description & 6-step guide */}
      {!isEdit && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-gene-purple/20 bg-gradient-to-r from-gene-purple/[0.10] to-life-cyan/[0.06] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">创造一个有边界的数字人格</p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">角色可以有鲜明性格，也应尊重你的现实生活、关系和退出选择。</p>
              </div>
              <span className="shrink-0 rounded-full border border-life-cyan/25 bg-panel/60 px-2 py-1 text-[10px] text-life-cyan">已填写 {filledCount}/6</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gene-purple/10">
              <div className="h-full rounded-full bg-gradient-to-r from-gene-purple to-life-cyan transition-all" style={{ width: `${Math.max(8, (filledCount / 6) * 100)}%` }} />
            </div>
          </div>
          <div className="flex gap-1 p-1 rounded-xl bg-surface border border-line">
            <button
              type="button"
              onClick={() => setMode('simple')}
              className={`flex-1 py-1.5 rounded-lg text-xs transition-colors ${
                mode === 'simple' ? 'bg-gene-purple text-white' : 'text-gray-500 hover:text-sub'
              }`}
            >
              快速描述
            </button>
            <button
              type="button"
              onClick={() => setMode('guided')}
              className={`flex-1 py-1.5 rounded-lg text-xs transition-colors ${
                mode === 'guided' ? 'bg-gene-purple text-white' : 'text-gray-500 hover:text-sub'
              }`}
            >
              精细刻画
            </button>
          </div>

          {mode === 'simple' ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述这个数字灵魂的性格、说话风格、背景故事..."
              rows={3}
              className="w-full px-4 py-3 bg-surface border border-line-strong rounded-xl text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors resize-none"
            />
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                至少填写一项即可生成。身份、语气和互动边界会让角色更鲜明，也更可控。
              </p>
              {STEP_FIELDS.map((f, i) => (
                <div key={f.key} className="rounded-xl border border-line bg-surface overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleSection(f.key)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="text-sm text-ink">
                      <span className="text-gene-purple mr-1.5">{i + 1}</span>
                      {f.title}
                    </span>
                    <span className="text-[10px] text-gray-500 flex items-center gap-1">
                      {fields[f.key].trim() ? '已填' : '可选'}
                      <span className="text-gray-500">{openSections[f.key] ? '▴' : '▾'}</span>
                    </span>
                  </button>
                  {openSections[f.key] && (
                    <div className="px-4 pb-3">
                      <textarea
                        value={fields[f.key]}
                        onChange={(e) => setField(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        rows={2}
                        className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors resize-none"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* File import — create mode only */}
      {!isEdit && (
        <div>
          <label className="block text-sm text-gray-400 mb-1.5">📎 导入参考资料（可选）</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`p-3 rounded-xl border border-dashed transition-colors space-y-2 ${
              isDragOver
                ? 'border-gene-purple/50 bg-gene-purple/5'
                : 'border-line-strong bg-surface'
            }`}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg bg-surface border border-line-strong text-xs text-sub hover:bg-surface-strong transition-colors shrink-0"
              >
                选择文件
              </button>
              <span className="text-xs text-gray-500 truncate">
                {selectedFile
                  ? selectedFile.name
                  : isDragOver
                    ? '释放文件以导入'
                    : '支持 PDF / Word / TXT，可拖拽文件到此处'}
              </span>
            </div>

            {isParsing && (
              <p className="text-xs text-gray-500 flex items-center gap-2">
                <svg className="animate-spin w-3 h-3" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
                </svg>
                解析中...
              </p>
            )}

            {parseError && (
              <p className="text-xs text-red-400">⚠️ 解析失败: {parseError}</p>
            )}

            {parserMissing && (
              <div className="flex items-center gap-3">
                <p className="text-xs text-gray-400">首次导入 PDF/Word 需下载解析组件（约 4MB，仅需一次）。</p>
                <button
                  type="button"
                  onClick={handleDownloadParser}
                  disabled={isDownloadingParser}
                  className="px-3 py-1.5 rounded-lg bg-gene-purple text-xs text-white hover:bg-[#5B4BD4] disabled:opacity-50 transition-colors shrink-0"
                >
                  {isDownloadingParser ? '下载中...' : '下载解析组件'}
                </button>
              </div>
            )}

            {documentText && !parseError && (
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-life-cyan">✅ 已解析 {documentText.length} 字</span>
                  <button
                    type="button"
                    onClick={() => setShowFilePreview(!showFilePreview)}
                    className="text-xs text-gray-500 hover:text-sub"
                  >
                    {showFilePreview ? '收起' : '预览'}
                  </button>
                </div>
                {showFilePreview && (
                  <div className="mt-2 p-3 rounded-lg bg-surface border border-line text-xs text-gray-400 max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {documentText.slice(0, 500)}
                    {documentText.length > 500 && '...'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Web search checkbox — create mode only */}
      {!isEdit && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enableWebSearch}
            onChange={(e) => setEnableWebSearch(e.target.checked)}
            className="w-4 h-4 rounded border-line-strong bg-surface text-gene-purple focus:ring-gene-purple/30"
          />
          <span className="text-xs text-gray-400">启用联网搜索 (提高基因序列丰度)</span>
        </label>
      )}

      {/* Generate button — create mode only */}
      {!isEdit && (
        <div>
          {isGenerating && (
            <div className="mb-3 px-4 py-3 rounded-xl bg-gene-purple/5 border border-gene-purple/10 space-y-2.5">
              <div className="flex items-center gap-3">
                <svg className="animate-spin w-4 h-4 text-gene-purple shrink-0" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
                </svg>
                <span className="text-sm text-gene-purple">
                  {generationProgress ? generationProgress.message : '正在连接基因库...'}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-gene-purple/15 overflow-hidden">
                <div
                  className="h-full bg-gene-purple transition-all duration-500 ease-out"
                  style={{ width: `${Math.round((generationProgress?.progress ?? 0.03) * 100)}%` }}
                />
              </div>
            </div>
          )}
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
            className="w-full py-3 rounded-xl bg-gene-purple hover:bg-[#5B4BD4] disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
                </svg>
                {generationProgress ? generationProgress.message : '基因测序中...'}
              </>
            ) : (
              systemPrompt ? '🔄 重新测序' : '⚡ 全节点扫描并生成基因序列'
            )}
          </button>
          {generationError && (
            <p className="mt-2 text-xs text-red-400">{generationError}</p>
          )}
        </div>
      )}

      {/* Candidate comparison — create mode only, before picking */}
      {!isEdit && candidates && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">选择一组最契合的基因序列：</p>
          <div className="grid grid-cols-3 gap-2">
            {candidates.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handlePickCandidate(c)}
                className="text-left p-3 rounded-xl border border-line hover:border-gene-purple hover:bg-gene-purple/5 transition-colors"
              >
                <div className="text-[10px] text-life-cyan mb-1">候选 {i + 1}</div>
                <div className="flex flex-wrap gap-1">
                  {c.tags.map((t) => (
                    <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-gene-purple/10 text-gene-purple">
                      {t}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] text-gray-600 line-clamp-5 whitespace-pre-line">{c.systemPrompt}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Generated result — editable fields */}
      {((!isEdit && (systemPrompt || candidates)) || isEdit) && (
        <div className="space-y-4">
          {/* Tags */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">性格标签</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gene-purple/10 text-gene-purple text-xs"
                >
                  {t}
                  <button type="button" onClick={() => removeTag(t)} className="text-gene-purple/70 hover:text-gene-purple">×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="添加标签，回车确认"
                className="flex-1 px-3 py-2 bg-surface border border-line-strong rounded-lg text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors"
              />
              <button
                type="button"
                onClick={addTag}
                className="px-3 py-2 rounded-lg bg-surface border border-line-strong text-xs text-sub hover:bg-surface-strong transition-colors"
              >
                添加
              </button>
            </div>
          </div>

          {/* Signature & greeting — edit mode only */}
          {isEdit && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">一句话签名</label>
                <input
                  type="text"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="凝练这个灵魂的一句话"
                  className="w-full px-4 py-3 bg-surface border border-line-strong rounded-xl text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1.5">示例开场白</label>
                <input
                  type="text"
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                  placeholder="TA 主动开口说的第一句话"
                  className="w-full px-4 py-3 bg-surface border border-line-strong rounded-xl text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1.5">口头禅（可选）</label>
                <input
                  type="text"
                  value={catchphrase}
                  onChange={(e) => setCatchphrase(e.target.value)}
                  placeholder="如：啧 / 有趣 / 你说呢（角色偶尔自然使用）"
                  className="w-full px-4 py-3 bg-surface border border-line-strong rounded-xl text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors"
                />
              </div>
            </>
          )}

          {/* System prompt */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              {isEdit ? '基因序列' : '生成的基因序列'}
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={isEdit ? '' : '点击上方按钮生成基因序列，或手动输入...'}
              rows={4}
              className="w-full px-4 py-3 bg-surface border border-line-strong rounded-xl text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-gene-purple/50 transition-colors resize-none"
            />
          </div>
        </div>
      )}

      {/* Publish to gene pool */}
      {!isEdit && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="w-4 h-4 rounded border-line-strong bg-surface text-gene-purple focus:ring-gene-purple/30"
          />
          <span className="text-xs text-gray-400">发布到基因库（其他用户可在基因库中发现并使用此角色）</span>
        </label>
      )}
      {isEdit && editCharacter.published && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="w-4 h-4 rounded border-line-strong bg-surface text-gene-purple focus:ring-gene-purple/30"
          />
          <span className="text-xs text-gray-400">已发布到基因库（取消勾选将撤回）</span>
        </label>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={!canSave || isSaving}
        className="w-full py-3 rounded-xl bg-life-cyan hover:bg-[#00B8B3] disabled:opacity-30 disabled:cursor-not-allowed text-sm font-semibold text-[#0F0F1A] transition-colors"
      >
        {isSaving ? '保存中...' : isEdit ? '重新编译基因序列' : '培育数字灵魂'}
      </button>
    </div>
  );
}
