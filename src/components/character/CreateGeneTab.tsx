import { avatarImageSrc } from '../../lib/avatar';
import { TagInput, PERSONALITY_TAGS } from '../ui/PhysicalInteractions';
import { useEffect, useId, useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { EmojiPicker } from '../ui/EmojiPicker';
import { ipc } from '../../lib/ipc-client';
import { stateRepo } from '../../db/state-repo';
import type { Character, StoryRelation } from '../../db/index';
import { taskChat } from '../../lib/ai/task-client';
import { ChatStyleImport } from './ChatStyleImport';
import { VoiceSamplesEditor } from './VoiceSamplesEditor';
import { GreetingReview } from './GreetingReview';
import { ReviewedSpeechModal } from '../chat/ReviewedSpeechModal';
import { validVoiceSamples, type VoiceSamples } from '../../lib/character-voice';
import { stylePrompt, stripLearnedStyle, type ChatStyleProfile } from '../../lib/chat-style-import';
import { memoryRepo } from '../../db/memory-repo';
import { db } from '../../db/index';
import { SecretaryPersonalitySelector } from '../secretary/SecretaryPersonalitySelector';
import { secretaryPersonality, stripSecretaryPersonality, withSecretaryPersonality, type SecretaryPersonality } from '../../lib/secretary/personality';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import '../../styles/character-editor-ui.css';
import { characterEditorRevision, characterRelationsRevision } from '../../lib/character-editor-revision';
import { commitCharacterEditor } from '../../db/character-editor-save';
import { useCharacterEditorDraft } from './useCharacterEditorDraft';
import { readCharacterDraftData, type CharacterDraftData, type CharacterDraftValues } from '../../lib/character-editor-draft-data';
import { CHARACTER_CREATE_STEPS } from '../../lib/character-editor-steps';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';

interface CreateGeneTabProps {
  editCharacter?: Character;
  onClose: () => void;
  onCancel?: () => void;
  onSavingChange?: (value: boolean) => void;
  onDirtyChange?: (value: boolean) => void;
  onDiscardReady?: (discard: (() => Promise<void>) | null) => void;
  footerTarget?: HTMLElement | null;
  active?: boolean;
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

export function CreateGeneTab({ editCharacter, onClose, onCancel, onSavingChange, onDirtyChange, onDiscardReady, footerTarget, active = true }: CreateGeneTabProps) {
  const formId = useId();
  const alive = useRef(true);
  useEffect(()=>{ alive.current=true; return()=>{ alive.current=false; }; },[]);
  const isEdit = !!editCharacter;
  const isSecretary = editCharacter?.agentProfile === 'secretary';
  const [personality, setPersonality] = useState<SecretaryPersonality>(() => secretaryPersonality(editCharacter?.secretaryPersonality));
  const [secretaryPreferences, setSecretaryPreferences] = useState(editCharacter?.secretaryPreferences ?? '');
  const apiKey = useAuthStore((s) => s.apiKey);
  const userId = useAuthStore((s) => s.userId) ?? '';
  const existingCharacters = useChatStore((s) => s.characters);
  const createCharacter = useChatStore((s) => s.createCharacter);
  const updateCharacter = useChatStore((s) => s.updateCharacter);

  const [name, setName] = useState(editCharacter?.name ?? '');
  const [avatar, setAvatar] = useState(editCharacter?.avatar ?? '🧬');
  const [systemPrompt, setSystemPrompt] = useState(() => {
    const raw = stripLearnedStyle(editCharacter?.systemPrompt ?? '');
    const original = isSecretary ? stripSecretaryPersonality(raw) : raw;
    const oldBoundary = editCharacter?.boundaries?.trim();
    const suffix = oldBoundary ? `[互动边界]\n${oldBoundary}` : '';
    return suffix && original.trimEnd().endsWith(suffix) ? original.trimEnd().slice(0, -suffix.length).trimEnd() : original;
  });
  const [tags, setTags] = useState<string[]>(editCharacter?.tags ?? []);
  const [learnedStyle, setLearnedStyle] = useState<ChatStyleProfile | undefined>(editCharacter?.learnedSpeechStyle);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSamples | undefined>(editCharacter?.voiceSamples);
  const [showSpeechSamples, setShowSpeechSamples] = useState(false);
  const [importedMemories, setImportedMemories] = useState<string[]>([]);
  const memoryImportIds = useRef(new Map<string, string>());
  const [styleBusy, setStyleBusy] = useState(false);
  const [signature, setSignature] = useState(editCharacter?.signature ?? '');
  const [greeting, setGreeting] = useState(editCharacter?.greeting ?? '');
  const [catchphrase, setCatchphrase] = useState(editCharacter?.catchphrase ?? '');
  const [boundaries, setBoundaries] = useState(editCharacter?.boundaries ?? '');
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [published, setPublished] = useState(editCharacter?.published ?? false);
  const [relationshipTargets, setRelationshipTargets] = useState<string[]>([]);
  const [relationshipMeta, setRelationshipMeta] = useState<Record<string, { label: string; description: string }>>({});
  const relationBaseline = useRef(JSON.stringify([[], {}]));
  const expectedRelations = useRef(relationBaseline.current);
  const expectedCharacter = useRef(editCharacter ? characterEditorRevision(editCharacter) : null);
  const [step, setStep] = useState(0);
  const currentStep = useRef(step); currentStep.current = step;
  const stepsRef = useRef<HTMLElement>(null);
  const previousStep = useRef(step);
  const stepAnimation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    if (previousStep.current === step) return;
    const direction = step > previousStep.current ? 1 : -1;
    previousStep.current = step;
    stepAnimation.current?.cancel();
    if (prefersReducedMotion()) return;
    const panel = stepsRef.current?.parentElement?.querySelector<HTMLElement>('[data-create-step]:not([hidden])');
    stepAnimation.current = panel?.animate([{ opacity: .85, transform: `translateX(${direction * 4}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' }) ?? null;
  }, [step]);
  useEffect(() => {
    const stop = subscribeReducedMotion(() => { if (prefersReducedMotion()) stepAnimation.current?.cancel(); });
    return () => { stop(); stepAnimation.current?.cancel(); };
  }, []);
  const goStep = (next: number) => {
    setStep(next);
    const scroller = stepsRef.current?.closest('[data-modal-scroll]');
    if (scroller) scroller.scrollTop = 0;
  };
  const [userIdentity, setUserIdentity] = useState('');
  const [userRelationship, setUserRelationship] = useState('');
  const [alreadyKnow, setAlreadyKnow] = useState(false);
  const [sharedPast, setSharedPast] = useState('');
  const [previewInput, setPreviewInput] = useState('今天有点累，你呢？');
  const [previewReply, setPreviewReply] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewNotice, setPreviewNotice] = useState('');
  const previewController = useRef<AbortController | null>(null);
  const draftEpoch = useRef(0);
  const personaRevision = useRef(0);
  const previewLock = useRef(false);

  const [fields, setFields] = useState<Record<FieldKey, string>>({
    identity: '',
    personality: '',
    speechStyle: '',
    speechExamples: '',
    boundaries: '',
    supplement: '',
  });
  const [mode, setMode] = useState<'simple' | 'guided'>('simple');
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
  const [generationNotice, setGenerationNotice] = useState('');
  const generationController = useRef<AbortController | null>(null);
  useEffect(() => {
    setIsGenerating(false); setGenerationProgress(null); setPreviewBusy(false); previewLock.current = false;
    return () => {
      generationController.current?.abort(); generationController.current = null;
      previewController.current?.abort(); previewController.current = null; previewLock.current = false;
    };
  }, [userId]);
  useEffect(() => {
    if (active) return;
    if (generationController.current) {
      generationController.current.abort(); generationController.current = null;
      setIsGenerating(false); setGenerationProgress(null);
      setGenerationNotice(ipc.character.supportsCancellation ? '已离开创建页，之前的塑造已停止。' : '已离开创建页，本次结果不再使用。');
    }
    if (previewController.current) {
      previewController.current.abort(); previewController.current = null; previewLock.current = false;
      setPreviewBusy(false); setPreviewNotice('已离开创建页，之前的试聊已停止。');
    }
  }, [active]);
  const [generationProgress, setGenerationProgress] = useState<{ step: string; message: string; progress: number } | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [relationsReady, setRelationsReady] = useState(!editCharacter);
  const saveLock = useRef(false);
  const savedCharacterId = useRef<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saveConflict, setSaveConflict] = useState<{ character: Character; relations: StoryRelation[] } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!editCharacter || !userId) return;
    let alive = true;
    void stateRepo.get(editCharacter.id, userId).then((state) => {
      if (!alive) return;
      setRelationsReady(true);
      const links = state?.storyRelations ?? [];
      relationBaseline.current = characterRelationsRevision(links);
      expectedRelations.current = relationBaseline.current;
      setRelationshipTargets(links.map((link) => link.targetCharacterId));
      setRelationshipMeta(Object.fromEntries(links.map((link) => [link.targetCharacterId, {
        label: link.label,
        description: link.description ?? '',
      }])));
    }).catch(() => { if (alive) setSaveError('人物关系未能读取，请关闭后重新打开；原有关系尚未修改。'); });
    return () => { alive = false; };
  }, [editCharacter, userId]);

  // Track editable data rather than steps, expanded sections or preview output.
  // Loaded relationships establish their own baseline and are not user edits.
  const draftValues: CharacterDraftValues = { name, avatar, systemPrompt, tags, learnedStyle, voiceSamples,
    importedMemories, signature, greeting, catchphrase, boundaries, published,
    personality, secretaryPreferences, userIdentity, userRelationship, alreadyKnow, sharedPast,
    fields, description, documentText, selectedFile };
  const editableSnapshot = JSON.stringify(draftValues);
  const initialSnapshot = useRef(editableSnapshot);
  const dirty = editableSnapshot !== initialSnapshot.current
    || JSON.stringify([relationshipTargets, relationshipMeta]) !== relationBaseline.current;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  const draftPayload: CharacterDraftData = { version: 2, values: draftValues, relationshipTargets, relationshipMeta,
    expectedCharacter: expectedCharacter.current, expectedRelations: expectedRelations.current,
    initialSnapshot: initialSnapshot.current, relationBaseline: relationBaseline.current,
    step, mode, enableWebSearch, previewInput };
  const draft = useCharacterEditorDraft({ userId, characterId: editCharacter?.id, enabled: relationsReady,
    dirty, payload: JSON.stringify(draftPayload), saving: isSaving, apply: (raw) => {
      const saved = readCharacterDraftData(raw), v = saved.values;
      initialSnapshot.current = saved.initialSnapshot; relationBaseline.current = saved.relationBaseline;
      expectedCharacter.current = saved.expectedCharacter; expectedRelations.current = saved.expectedRelations;
      setName(v.name); setAvatar(v.avatar); setSystemPrompt(v.systemPrompt); setTags(v.tags);
      setLearnedStyle(v.learnedStyle); setVoiceSamples(v.voiceSamples); setImportedMemories(v.importedMemories);
      setSignature(v.signature); setGreeting(v.greeting); setCatchphrase(v.catchphrase); setBoundaries(v.boundaries);
      setPublished(v.published); setPersonality(secretaryPersonality(v.personality)); setSecretaryPreferences(v.secretaryPreferences);
      setUserIdentity(v.userIdentity); setUserRelationship(v.userRelationship); setAlreadyKnow(v.alreadyKnow); setSharedPast(v.sharedPast);
      setFields(v.fields); setDescription(v.description); setDocumentText(v.documentText); setSelectedFile(v.selectedFile);
      setRelationshipTargets(saved.relationshipTargets); setRelationshipMeta(saved.relationshipMeta);
      setStep(saved.step); setMode(saved.mode); setEnableWebSearch(saved.enableWebSearch); setPreviewInput(saved.previewInput);
    } });
  useEffect(() => {
    onDiscardReady?.(draft.discard);
    return () => onDiscardReady?.(null);
  }, [draft.discard, onDiscardReady]);

  const filledCount = STEP_FIELDS.filter((f) => fields[f.key].trim().length > 0).length;
  const canGenerate = name.trim().length >= 1 && !isEdit && !styleBusy && (
    !!learnedStyle?.rules.trim() || (mode === 'simple' ? !!(description.trim() || fields.identity.trim()) : filledCount > 0)
  );
  const canSave = draft.ready && !draft.pending && relationsReady && !styleBusy && !!userId && name.trim().length >= 1 && systemPrompt.trim().length > 0;
  const relationContext = [
    userIdentity.trim() && `用户的身份：${userIdentity.trim()}`,
    userRelationship.trim() && `你与用户的关系：${userRelationship.trim()}`,
    alreadyKnow ? '出场时你与用户已认识，按既有关系自然交流。' : '出场时是初次相识，不编造共同经历。',
    alreadyKnow && sharedPast.trim() && `用户为你们设定的过去（角色背景，不是聊天记录）：${sharedPast.trim()}`,
  ].filter(Boolean).join('\n');
  const composedPrompt = () => {
    const prompt = [systemPrompt.trim(), boundaries.trim() && `[互动边界]\n${boundaries.trim()}`,
      !isEdit && fields.speechStyle.trim() && `[用户指定的表达方式]\n${fields.speechStyle.trim()}`,
      !isEdit && fields.speechExamples.trim() && `[用户指定的表达示例]\n${fields.speechExamples.trim()}`,
      !isEdit && `[与你的关系]\n${relationContext}`, stylePrompt(learnedStyle)].filter(Boolean).join('\n\n');
    return isSecretary ? withSecretaryPersonality(prompt, personality, secretaryPreferences) : prompt;
  };
  useEffect(() => {
    draftEpoch.current++; personaRevision.current++; setPreviewReply(''); setPreviewError('');
    if (generationController.current) {
      const controller = generationController.current;
      generationController.current = null; controller.abort();
      setIsGenerating(false); setGenerationProgress(null);
      setGenerationNotice('设定已更新，已停止之前的塑造。');
    }
    if (previewController.current) {
      previewController.current.abort(); previewController.current = null; previewLock.current = false;
      setPreviewBusy(false); setPreviewNotice('设定已更新，已停止之前的试聊。');
    }
  },
    [systemPrompt, boundaries, userIdentity, userRelationship, alreadyKnow, sharedPast, name, fields, description, learnedStyle, importedMemories, personality, secretaryPreferences]);
  useEffect(() => () => { draftEpoch.current++; }, []);
  const tryConversation = async () => {
    if (!canSave || !previewInput.trim() || previewLock.current || generationController.current || !alive.current || useAuthStore.getState().userId !== userId) return;
    const controller = new AbortController(); previewController.current = controller;
    const current = () => previewController.current === controller && alive.current && useAuthStore.getState().userId === userId && !controller.signal.aborted;
    previewLock.current = true; setPreviewBusy(true); setPreviewError(''); setPreviewNotice(''); setGenerationNotice('');
    const epoch = draftEpoch.current;
    try {
      // Preview uses the draft alone; it never imports another character's memory.
      const result = await taskChat({ apiKey: apiKey ?? '', disableThinking: true, signal: controller.signal,
        maxTokens: 240, messages: [{ role: 'system', content: `${composedPrompt()}\n${importedMemories.length ? '[用户确认的共同记忆]\n' + importedMemories.join('\n') : ''}\n像微信私聊一样自然回应，保持人物性格，不写说明和长篇旁白。` },
          { role: 'user', content: previewInput.trim() }] });
      if (!result.content?.trim()) throw new Error('暂时没能试聊成功，可以重试或直接创建。');
      if (current() && epoch === draftEpoch.current) setPreviewReply(result.content.trim());
    } catch { if (current() && epoch === draftEpoch.current) setPreviewError('试聊未完成，请检查模型设置后重试，或直接创建。'); }
    finally { if (previewController.current === controller) { previewController.current = null; previewLock.current = false; if (alive.current) setPreviewBusy(false); } }
  };
  const stopPreview = (notice = '试聊已停止，填写内容仍在。') => {
    previewController.current?.abort(); previewController.current = null; previewLock.current = false;
    setPreviewBusy(false); setPreviewError(''); setPreviewNotice(notice);
  };

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
    if (!canGenerate || generationController.current || !alive.current || useAuthStore.getState().userId !== userId) return;
    const controller = new AbortController();
    if (previewController.current) stopPreview('已切换为人物塑造，之前的试聊已停止。');
    generationController.current = controller;
    const current = () => generationController.current === controller && alive.current && useAuthStore.getState().userId === userId && !controller.signal.aborted;
    const epoch = personaRevision.current;
    const startedOnStep = currentStep.current;
    setIsGenerating(true);
    setGenerationError(null);
    setGenerationNotice('');
    setPreviewNotice('');
    setGenerationProgress(null);
    setCandidates(null);

    const genFields = mode === 'simple' ? { description: description.trim(), identity: fields.identity, supplement: relationContext,
      speechStyle: learnedStyle?.rules, speechExamples: learnedStyle?.examples.join('\n') }
      : { ...fields, speechStyle: [fields.speechStyle, learnedStyle?.rules].filter(Boolean).join('\n'),
          speechExamples: [fields.speechExamples, learnedStyle?.examples.join('\n')].filter(Boolean).join('\n'), supplement: `${fields.supplement}\n${relationContext}` };
    try {
    const result = await ipc.character.generate(
      {
        apiKey: apiKey ?? '',
        characterName: name.trim(),
        fields: genFields,
        enableWebSearch,
        documentContext: documentText ?? undefined,
        count: 3,
      },
      (step, message, progress) => { if (current()) setGenerationProgress({ step, message, progress }); },
      { signal: controller.signal },
    );
    if (!current()) return;
    if (result.cancelled) { setGenerationNotice('已停止塑造，填写内容已保留。'); return; }

    if (epoch !== personaRevision.current) {
      setGenerationError('设定已更新，请按新设定重新塑造。');
    } else if (result.error) {
      setGenerationError(ERROR_MAP[result.error] ?? ERROR_MAP['server:error']);
    } else if (result.candidates && result.candidates.length > 0) {
      setCandidates(result.candidates);
      if (currentStep.current === startedOnStep) goStep(4);
    }
    } catch { if (current()) setGenerationError('人物塑造暂时未完成，填写内容已保留，可以重试。'); }
    finally {
      if (generationController.current === controller) {
        generationController.current = null;
        if (alive.current) { setIsGenerating(false); setGenerationProgress(null); }
      }
    }
  };

  const stopGeneration = () => {
    const controller = generationController.current;
    if (!controller) return;
    generationController.current = null;
    controller.abort();
    setIsGenerating(false); setGenerationProgress(null);
    setGenerationError(null); setGenerationNotice('已停止塑造，填写内容已保留。');
  };

  const handlePickCandidate = (c: Candidate) => {
    setTags(c.tags);
    setSignature(c.signature);
    setGreeting(c.greeting);
    setSystemPrompt(c.systemPrompt);
    setBoundaries((current) => current || fields.boundaries.trim());
    setCandidates(null);
    goStep(2);
  };


  const handleSave = async () => {
    if (!canSave || saveLock.current || !alive.current || useAuthStore.getState().userId !== userId) return;
    setNameError(null);

    if (name.trim().length < 1) {
      setNameError('请为数字灵魂命名');
      return;
    }

    saveLock.current = true; onSavingChange?.(true); setIsSaving(true); setSaveError('');
    let conflict: { character: Character; relations: StoryRelation[] } | null = null;
    try {
    await draft.pause();
    const assertOwner = () => { if (!alive.current || useAuthStore.getState().userId !== userId) throw new Error('账号已切换'); };
    const finalSystemPrompt = composedPrompt();
    if (useAuthStore.getState().userId !== userId) throw new Error('账号已切换');

    let createdId = savedCharacterId.current;
    // Repositories join this transaction, including inverse relationships and
    // the memory evidence ledger. No selection/network work runs before commit.
    const committed = await commitCharacterEditor(async () => {
    assertOwner();

    if (isEdit) {
      const current = await db.characters.get(editCharacter.id);
      if (!current || current.createdBy !== userId || current.isPreset) throw new Error('角色已不在当前账号');
      const currentState = await stateRepo.get(editCharacter.id, userId);
      if (characterEditorRevision(current) !== expectedCharacter.current
        || characterRelationsRevision(currentState?.storyRelations ?? []) !== expectedRelations.current) {
        conflict = { character: current, relations: currentState?.storyRelations ?? [] };
        throw new Error('editor:conflict');
      }
      await updateCharacter(editCharacter.id, {
        ...(isSecretary ? { secretaryPersonality: personality, secretaryPreferences } : {}),
        name: name.trim(),
        avatar,
        systemPrompt: finalSystemPrompt,
        tags,
        signature: signature.trim(),
        greeting: greeting.trim(),
        catchphrase: catchphrase.trim() || undefined,
        boundaries: boundaries.trim() || undefined,
        published,
        learnedSpeechStyle: learnedStyle,
        voiceSamples: validVoiceSamples({ ...editCharacter, name: name.trim(), systemPrompt: finalSystemPrompt, tags, signature: signature.trim(), greeting: greeting.trim(), catchphrase: catchphrase.trim() || undefined, boundaries: boundaries.trim() || undefined, voiceSamples }),
      }, { deferRefresh: true });
      assertOwner();
      const stored = await db.characters.get(editCharacter.id);
      if (!stored || stored.createdBy !== userId) throw new Error('角色已不在当前账号');
      await stateRepo.replaceStoryRelations(editCharacter.id, userId, relationshipTargets.map((characterId) => ({
        characterId,
        label: relationshipMeta[characterId]?.label ?? '故事关联',
        description: relationshipMeta[characterId]?.description ?? '',
      })));
    } else {
      const created = createdId ? { id: createdId } : await createCharacter({
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
      }, { deferActivation: true });
      createdId = created.id;
      assertOwner();
      const stored = await db.characters.get(created.id);
      if (!stored || stored.createdBy !== userId || stored.isPreset) throw new Error('角色已不在当前账号');
      if (savedCharacterId.current) {
        const currentState = await stateRepo.get(created.id, userId);
        if (characterEditorRevision(stored) !== expectedCharacter.current
          || characterRelationsRevision(currentState?.storyRelations ?? []) !== expectedRelations.current) {
          conflict = { character: stored, relations: currentState?.storyRelations ?? [] };
          throw new Error('editor:conflict');
        }
      }
      // A retry after post-commit navigation failure reuses the saved character.
      await updateCharacter(created.id, { name: name.trim(), avatar, systemPrompt: finalSystemPrompt,
        tags, signature: signature.trim(), greeting: greeting.trim(), catchphrase: catchphrase.trim() || undefined,
        boundaries: boundaries.trim() || undefined, published, learnedSpeechStyle: learnedStyle,
        voiceSamples: validVoiceSamples({ ...stored, name: name.trim(), systemPrompt: finalSystemPrompt, tags,
          signature: signature.trim(), greeting: greeting.trim(), catchphrase: catchphrase.trim() || undefined,
          boundaries: boundaries.trim() || undefined, voiceSamples }) }, { deferRefresh: true });
      assertOwner();
      await stateRepo.replaceStoryRelations(created.id, userId, relationshipTargets.map((characterId) => ({
        characterId,
        label: relationshipMeta[characterId]?.label ?? '故事关联',
        description: relationshipMeta[characterId]?.description ?? '',
      })));
    }

    const memoryCharacterId = isEdit ? editCharacter.id : createdId;
    if (importedMemories.length && memoryCharacterId) {
      const owner = await db.characters.get(memoryCharacterId);
      if (owner?.createdBy !== userId || useAuthStore.getState().userId !== userId) throw Error('无法为其他账号导入记忆');
      for (const content of importedMemories) {
        let id = memoryImportIds.current.get(content);
        if (!id) { id = crypto.randomUUID(); memoryImportIds.current.set(content, id); }
        const previous = await db.memories.get(id);
        if (previous?.content === content) continue;
        await memoryRepo.create({ id, characterId: memoryCharacterId, userId, content,
          type: 'auto', pinned: true, memoryKind: 'fact', status: 'active', confidence: 1,
          createdAt: Date.now(), updatedAt: Date.now() });
      }
    }
    assertOwner();
    const id = isEdit ? editCharacter.id : createdId!;
    const character = await db.characters.get(id);
    const state = await stateRepo.get(id, userId);
    const clearedDraft = await draft.clearForCommit();
    assertOwner();
    return { character, state, clearedDraft };
    });
    savedCharacterId.current = createdId;
    draft.committed(committed.clearedDraft);
    if (committed.character) expectedCharacter.current = characterEditorRevision(committed.character);
    expectedRelations.current = characterRelationsRevision(committed.state?.storyRelations ?? []);
    assertOwner();
    await useChatStore.getState().loadCharacters();
    assertOwner();
    if (!isEdit && createdId) await useChatStore.getState().selectCharacter(createdId);
    if (alive.current && useAuthStore.getState().userId === userId) onClose();
    } catch (cause) { if (alive.current && useAuthStore.getState().userId === userId) {
      if (conflict) setSaveConflict(conflict);
      setSaveError(cause instanceof Error && cause.message === 'editor:conflict'
        ? '角色资料或故事关系已在别处修改，本次未覆盖。填写内容仍在，请先核对最新资料。'
        : '保存未完成，填写内容已保留，请重试。');
    } }
    finally { saveLock.current = false; onSavingChange?.(false); if (alive.current) setIsSaving(false); }
  };

  const activity = isGenerating ? <div className="flex items-center justify-between gap-3 text-sm text-sub"><p role="status">{generationProgress?.message || '正在塑造人物设定…'}</p>{ipc.character.supportsCancellation && <button type="button" onClick={stopGeneration} className="vg-button vg-button-secondary shrink-0">停止塑造</button>}</div>
    : previewBusy ? <div className="flex items-center justify-between gap-3 text-sm text-sub"><p role="status">正在试聊…</p><button type="button" onClick={() => stopPreview()} className="vg-button vg-button-secondary shrink-0">停止试聊</button></div>
    : generationNotice || previewNotice ? <p role="status" className="text-sm text-sub">{previewNotice || generationNotice}</p> : null;
  const footer = <div className="p-4 space-y-3" style={{background:isEdit?'var(--bg-panel)':'var(--bg)'}}>
    {activity || (draft.ready && !draft.pending && !draft.error && <p className="text-xs text-sub" role="status">{dirty ? draft.status === 'saved' ? '草稿已保存在本机' : '正在保留草稿…' : '本机草稿 · 自动保留'}</p>)}
    <div className="flex gap-3" aria-label={isEdit ? '保存角色设置' : '创建角色操作'}>
      {isEdit ? <><button type="button" disabled={isSaving} onClick={onCancel ?? onClose} className="vg-button vg-button-secondary">取消</button><button type="button" onClick={()=>void handleSave()} disabled={!canSave || isSaving} aria-busy={isSaving} className="vg-button vg-button-primary flex-1">{isSaving ? '正在保存…' : saveError ? '重试保存' : '保存角色'}</button></> : <>
        {step > 0 && <button type="button" disabled={isSaving} onClick={() => goStep(step - 1)} className="vg-button vg-button-secondary">上一步</button>}
        {step < 4 ? <button type="button" disabled={isSaving || !draft.ready || !!draft.pending || !name.trim()} onClick={() => goStep(step + 1)} className="vg-button vg-button-primary flex-1">下一步</button>
          : <button type="button" onClick={()=>void handleSave()} disabled={!canSave || isSaving || isGenerating || !!candidates} aria-busy={isSaving} className="vg-button vg-button-primary flex-1">{isSaving ? '正在保存…' : '让 TA 来到我的世界'}</button>}
      </>}
    </div>
  </div>;
  return (
    <div className="vg-character-editor space-y-5" data-create={!isEdit || undefined} aria-busy={isSaving}>
      {!draft.ready && <p className="text-sm text-sub" role="status">正在读取本机草稿…</p>}
      {draft.pending && <div className="vg-editor-card space-y-3">
        <p className="font-medium text-ink">有一份上次未保存的内容</p>
        <p className="text-sm text-sub">只保存在当前账号的本机。恢复会替换当前填写；未完成的文件解析或聊天导入需要重新选择。</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={!relationsReady} className="vg-button vg-button-primary" onClick={draft.restore}>恢复草稿</button>
          <button type="button" className="vg-button vg-button-secondary" onClick={() => void draft.keepCurrent()}>清除旧草稿，保留当前填写</button>
        </div>
      </div>}
      {draft.error && <div role="status" className="text-sm text-sub space-y-2"><p>{draft.error}</p><button type="button" className="vg-button vg-button-secondary" onClick={() => void draft.reload()}>重新读取草稿</button></div>}
      {generationError && <p role="alert" className="text-sm text-[color:var(--vg-danger)]">{generationError}</p>}
      {!isEdit && candidates && step !== 4 && <button type="button" className="vg-button vg-button-secondary w-full" onClick={() => goStep(4)}>查看生成的候选</button>}
      <Modal open={!!saveConflict} presentation="dialog" title="核对最新修改" onClose={() => setSaveConflict(null)} canSnapshotOnExit={()=>false} closeOnBackdrop={false}
        footer={saveConflict ? <div className="flex flex-col gap-3 p-4">
          <button type="button" className="vg-button vg-button-secondary" onClick={() => setSaveConflict(null)}>保留填写内容</button>
          <button type="button" className="vg-button vg-button-danger" onClick={() => {
            expectedCharacter.current = characterEditorRevision(saveConflict.character);
            expectedRelations.current = characterRelationsRevision(saveConflict.relations);
            setSaveConflict(null);
            void handleSave();
          }}>确认覆盖并保存</button>
        </div> : undefined}>
        {saveConflict && <div className="p-4 space-y-4">
          <p className="text-sm text-sub">角色资料或故事关系已在别处修改。你的填写内容仍在，下方是目前已保存的版本。</p>
          <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-line bg-surface p-4 space-y-3 text-sm text-ink" tabIndex={0} aria-label="目前已保存的角色资料">
            <p className="font-semibold">{saveConflict.character.name}</p>
            <p className="whitespace-pre-wrap break-words">{saveConflict.character.systemPrompt}</p>
            <p>性格：{saveConflict.character.tags?.join('、') || '未填写'}</p>
            <p>签名：{saveConflict.character.signature || '未填写'}</p>
            <p>开场白：{saveConflict.character.greeting || '未填写'}</p>
            <p>口头禅：{saveConflict.character.catchphrase || '未填写'}</p>
            <p>互动边界：{saveConflict.character.boundaries || '未填写'}</p>
            <p>故事关系：{saveConflict.relations.length ? saveConflict.relations.map(link => `${existingCharacters.find(character => character.id === link.targetCharacterId)?.name ?? '关联角色'} · ${link.label}${link.description ? `（${link.description}）` : ''}`).join('；') : '暂无'}</p>
          </div>
          <p className="text-sm text-sub">确认后将使用你当前填写的角色资料和故事关系替换这一版本；若它再次变化，会重新请你核对。</p>
        </div>}
      </Modal>
      <nav ref={stepsRef} aria-label={isEdit ? '角色设置分组' : '创建角色步骤'} className={isEdit ? 'grid grid-cols-2 sm:grid-cols-4 gap-2' : 'vg-create-steps flex justify-between relative'}>
        {!isEdit && <span aria-hidden="true" className="absolute border-t border-line" style={{ left:'10%', right:'10%', top:20 }}/>}
        {(isEdit ? ['基本资料','故事关系','说话方式','人物设定'] : CHARACTER_CREATE_STEPS.map(item => item.label)).map((title,i)=><button type="button" key={title} aria-label={title} disabled={isSaving} aria-current={step===i ? 'step' : undefined} aria-pressed={step===i} onClick={()=>goStep(i)} className={isEdit ? `min-w-0 rounded-xl px-2 py-3 text-sm font-medium ${step===i ? 'border border-line bg-surface text-ink' : 'border border-line bg-panel text-sub'}` : 'relative min-w-11 flex-1 flex flex-col items-center gap-2 py-2 text-xs text-sub'}>
          {!isEdit && <span aria-hidden="true" className="w-6 h-6 rounded-full border flex items-center justify-center" style={{ background:i<=step?'var(--vg-action)':'var(--bg)',color:i<=step?'var(--vg-on-action)':'var(--text)',borderColor:i<=step?'var(--vg-action)':'var(--border)' }}>{i<step?<Icon name="check" size={14}/>:i+1}</span>}{title}
        </button>)}
      </nav>
      {!isEdit && <div className={step === 0 ? 'text-center py-3' : 'py-3'}><h3 className="font-semibold text-ink" style={{fontSize:'var(--vg-type-title)',lineHeight:'var(--vg-leading-title)'}}>{CHARACTER_CREATE_STEPS[step].title}</h3><p className="mt-2 text-sm text-sub">{CHARACTER_CREATE_STEPS[step].description}</p></div>}
      <fieldset disabled={isSaving || !draft.ready || !!draft.pending} className="min-w-0 space-y-5">
      <div data-create-step className={isEdit ? "vg-editor-card space-y-5" : "space-y-5"} hidden={step !== 0}>
      {/* Avatar: emoji + image upload */}
      <div>
        {isEdit && <p className="text-sm text-sub mb-1.5">头像</p>}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />
        <div className={isEdit ? "flex items-center gap-3" : "flex flex-col items-center gap-3 pb-3"}>
          <div className="relative">
            <button
              type="button"
              aria-label="选择头像"
              aria-haspopup="dialog"
              aria-expanded={showEmojiPicker}
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setAvatarDragOver(true); }}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setAvatarDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setAvatarDragOver(false); }}
              onDrop={handleAvatarDrop}
              className={`${isEdit ? "w-14 h-14 rounded-xl text-3xl" : "w-24 h-24 rounded-full text-4xl"} flex items-center justify-center border transition-colors overflow-hidden ${
                avatarDragOver
                  ? 'border-gene-purple bg-gene-purple/20'
                  : 'border-line-strong bg-surface hover:bg-surface-strong'
              }`}
            >
              {avatarImageSrc(avatar) ? (
                <img src={avatarImageSrc(avatar)} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                !isEdit && avatar === '🧬' ? <Icon name="profile" size={38}/> : avatar
              )}
            </button>
            {showEmojiPicker && (
              <Modal open presentation="dialog" title="选择头像" width="max-w-sm" onClose={()=>setShowEmojiPicker(false)} canSnapshotOnExit={()=>false}>
              <div className="p-3">
                <EmojiPicker
                  onSelect={(emoji) => {
                    setAvatar(emoji);
                    setShowEmojiPicker(false);
                  }}
                />
              </div>
              </Modal>
            )}
          </div>

          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            style={!isEdit ? {borderRadius:'var(--vg-radius-pill)',background:'transparent'} : undefined}
            className="px-3 py-1.5 rounded-lg bg-surface border border-line-strong text-xs text-sub hover:bg-surface-strong transition-colors"
          >
            {avatarImageSrc(avatar) ? '更换图片' : isEdit ? '上传图片' : '上传头像'}
          </button>
        </div>
      </div>
      {/* Name */}
      <div>
        <label htmlFor={`${formId}-name`} className="block text-sm text-sub mb-1.5">姓名 <span className="text-xs text-sub">· 必填</span></label>
        <input
          id={`${formId}-name`}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? `${formId}-name-error` : undefined}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          placeholder="为数字灵魂命名"
          className={`w-full px-4 py-3 bg-surface border rounded-xl text-sm text-ink placeholder-gray-500 transition-colors ${
            nameError ? 'border-red-500/50' : 'border-line-strong'
          }`}
        />
        {nameError && <p id={`${formId}-name-error`} role="alert" className="mt-1 text-xs text-[color:var(--vg-danger)]">{nameError}</p>}
      </div>

      {!isEdit && <label className="block text-sm text-sub">一句话身份
        <textarea value={fields.identity} onChange={e => setField('identity', e.target.value)} rows={2}
          placeholder="例如：嘴硬心软的修理师，住在海边小城" className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
      </label>}
      </div>
      <div data-create-step className={isEdit ? "vg-editor-card space-y-5" : "space-y-5"} hidden={step !== (isEdit ? 1 : 3)}>
      {isSecretary && <SecretaryPersonalitySelector value={personality} preferences={secretaryPreferences} onChange={setPersonality} onPreferencesChange={setSecretaryPreferences} disabled={isSaving} personalityLocked />}
      {!isEdit && <section className="space-y-4">
        <label className="block text-sm text-sub">你的身份（可选）
          <input value={userIdentity} onChange={e => setUserIdentity(e.target.value)} placeholder="例如：我自己、同班同学、一位旅人"
            className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
        </label>
        <label className="block text-sm text-sub">你们的关系（可选）
          <input value={userRelationship} onChange={e => setUserRelationship(e.target.value)} placeholder="例如：搭档、旧友、恋人，也可以自由定义"
            className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
        </label>
        <div className="flex gap-2">{[{value:false,label:'初次相识'},{value:true,label:'已经认识'}].map(option => <button key={option.label} type="button"
          aria-pressed={alreadyKnow === option.value} onClick={() => setAlreadyKnow(option.value)}
          className={`flex-1 rounded-xl border p-3 text-sm ${alreadyKnow === option.value ? 'border-life-cyan/40 bg-life-cyan/10 text-ink' : 'border-line text-sub'}`}>{option.label}</button>)}</div>
        {alreadyKnow && <label className="block text-sm text-sub">共同过去（可选）
          <textarea value={sharedPast} onChange={e => setSharedPast(e.target.value)} rows={3} placeholder="写下你希望成为出场背景的经历"
            className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" /></label>}
      </section>}
      <details open={isEdit || undefined} className="rounded-2xl border border-line p-3">
      <summary className="cursor-pointer py-1 text-sm font-medium text-ink">与其他角色的关系（可选）</summary>
      <section className="rounded-2xl border border-life-cyan/20 bg-gradient-to-br from-life-cyan/[0.07] to-gene-purple/[0.08] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs tracking-[0.18em] text-[color:var(--vg-cyan)]">STORY RELATIONSHIPS</p>
            <h3 className="mt-1 text-sm font-semibold text-ink">把 TA 放进你的故事世界</h3>
            <p className="mt-1 text-xs leading-relaxed text-sub">设定的关系会直接出现在关系网络中；群聊和普通对话不会自动改变它。</p>
          </div>
          <span className="shrink-0 rounded-full bg-life-cyan/10 px-2 py-1 text-xs text-[color:var(--vg-cyan)]">{relationshipTargets.length} 条连接</span>
        </div>

        {existingCharacters.filter((character) => character.id !== editCharacter?.id).length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-3 text-xs text-sub">创建更多角色后，就能在这里为他们设定同伴、宿敌、家人或任何你想要的故事关系。</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {existingCharacters.filter((character) => character.id !== editCharacter?.id).map((character) => {
              const selected = relationshipTargets.includes(character.id);
              return (
                <button
                  type="button"
                  key={character.id}
                  aria-pressed={selected}
                  onClick={() => {
                    if (selected) {
                      setRelationshipTargets((current) => current.filter((id) => id !== character.id));
                      return;
                    }
                    setRelationshipTargets((current) => [...current, character.id]);
                    setRelationshipMeta((current) => ({ ...current, [character.id]: current[character.id] ?? { label: '故事关联', description: '' } }));
                  }}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors ${selected ? 'border-life-cyan/50 bg-life-cyan/12 text-[color:var(--vg-cyan)]' : 'border-line bg-panel text-sub hover:border-life-cyan/30'}`}
                >
                  <span className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-surface text-xs">{avatarImageSrc(character.avatar) ? <img src={avatarImageSrc(character.avatar)} alt="" className="h-full w-full object-cover" /> : character.avatar}</span>
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
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-ink"><span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-lg bg-surface text-xs">{avatarImageSrc(target.avatar) ? <img src={avatarImageSrc(target.avatar)} alt="" className="h-full w-full object-cover" /> : target.avatar}</span>{target.name}</div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {RELATIONSHIP_PRESETS.map((preset) => (
                      <button
                        type="button"
                        key={preset.label}
                        aria-pressed={meta.label === preset.label}
                        onClick={() => setRelationshipMeta((current) => ({
                          ...current,
                          [targetId]: { label: preset.label, description: meta.description || preset.description },
                        }))}
                        className={`rounded-full border px-2 py-1 text-xs transition-colors ${meta.label === preset.label ? 'border-life-cyan/50 bg-life-cyan/12 text-[color:var(--vg-cyan)]' : 'border-line bg-surface text-sub hover:border-life-cyan/35 hover:text-[color:var(--vg-cyan)]'}`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-sm text-sub">关系名称<input value={meta.label} onChange={(event) => setRelationshipMeta((current) => ({ ...current, [targetId]: { ...meta, label: event.target.value } }))} maxLength={18} placeholder="例如：搭档" className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
                    <label className="text-sm text-sub">关系锚点<input value={meta.description} onChange={(event) => setRelationshipMeta((current) => ({ ...current, [targetId]: { ...meta, description: event.target.value } }))} maxLength={100} placeholder="他们为何如此相处？" className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-sub">关系锚点会保留在人物网络中，并在话题相关时成为两位角色理解彼此的共同背景。</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
      </details>
      </div>
      {!isEdit && <div data-create-step hidden={step !== 2} className="space-y-5">
        <label className="block text-sm text-sub">说话风格（可选）
          <textarea aria-label="说话风格" value={fields.speechStyle} onChange={event => setField('speechStyle', event.target.value)} rows={3}
            placeholder="例如：用短句，偶尔嘴硬，关心落在具体的小事上" className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
        </label>
        <label className="block text-sm text-sub">说话示例（可选）
          <textarea aria-label="说话示例" value={fields.speechExamples} onChange={event => setField('speechExamples', event.target.value)} rows={3}
            placeholder="写一两句 TA 真的会说的话" className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
        </label>
        <label className="block text-sm text-sub">互动边界（可选）
          <textarea aria-label="互动边界" value={boundaries || fields.boundaries} onChange={event => { setBoundaries(event.target.value); setField('boundaries', event.target.value); }} rows={3}
            placeholder="哪些话题需要谨慎？希望 TA 如何尊重你的选择？" className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
        </label>
        <details className="rounded-xl border border-line p-4"><summary className="text-sm text-ink">从聊天记录学习（可选）</summary>
          <ChatStyleImport active={active && step === 2} value={learnedStyle} onChange={setLearnedStyle} memories={importedMemories} onMemoriesChange={setImportedMemories} disabled={isGenerating || isSaving} onBusyChange={setStyleBusy} />
        </details>
      </div>}
      <div data-create-step className={isEdit ? "vg-editor-card space-y-5" : "space-y-4"} hidden={step !== (isEdit ? 2 : 1)}>
      {isEdit && <ChatStyleImport active={active && step === 2} value={learnedStyle} onChange={setLearnedStyle} memories={importedMemories} onMemoriesChange={setImportedMemories} disabled={isGenerating || isSaving} onBusyChange={setStyleBusy} />}
      {/* Create-mode input: toggle between simple description & 6-step guide */}
      {!isEdit && (
        <div className="space-y-3">
          <div className="flex gap-1 p-1 rounded-xl bg-surface border border-line">
            <button
              type="button"
              aria-pressed={mode === 'simple'}
              onClick={() => setMode('simple')}
              className="flex-1 py-1.5 rounded-lg text-sm text-sub transition-colors"
              style={mode === 'simple' ? {background:'var(--vg-action)',color:'var(--vg-on-action)'} : undefined}
            >
              自由描述
            </button>
            <button
              type="button"
              aria-pressed={mode === 'guided'}
              onClick={() => setMode('guided')}
              className="flex-1 py-1.5 rounded-lg text-sm text-sub transition-colors"
              style={mode === 'guided' ? {background:'var(--vg-action)',color:'var(--vg-on-action)'} : undefined}
            >
              分项设定
            </button>
          </div>

          {mode === 'simple' ? (
            <textarea
              aria-label="快速描述人物"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="TA 在意什么，如何看待这个世界？"
              rows={4}
              className="w-full px-4 py-3 bg-surface border border-line-strong rounded-xl text-sm text-ink placeholder-gray-500 transition-colors resize-none"
            />
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-sub">
                至少填写一项即可生成。身份、语气和互动边界会让角色更鲜明，也更可控。
              </p>
              {STEP_FIELDS.filter(f => !["speechStyle", "speechExamples", "boundaries"].includes(f.key)).map((f, i) => (
                <div key={f.key} className="rounded-xl border border-line bg-surface overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={openSections[f.key]}
                    onClick={() => toggleSection(f.key)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="text-sm text-ink">
                      <span className="text-[color:var(--vg-accent)] mr-1.5">{i + 1}</span>
                      {f.title}
                    </span>
                    <span className="text-xs text-sub flex items-center gap-1">
                      {fields[f.key].trim() ? '已填' : '可选'}
                      <Icon name="chevron" size={14} className={openSections[f.key] ? '-rotate-90' : 'rotate-90'} />
                    </span>
                  </button>
                  {openSections[f.key] && (
                    <div className="px-4 pb-3">
                      <textarea
                        aria-label={f.title}
                        value={fields[f.key]}
                        onChange={(e) => setField(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        rows={2}
                        className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-sm text-ink placeholder-gray-500 transition-colors resize-none"
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
        <details className="rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-sm text-ink">参考资料（可选）</summary>
          <p className="text-sm text-sub my-3">用已有资料补充人物设定。</p>
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
              <span className="text-xs text-sub truncate">
                {selectedFile
                  ? selectedFile.name
                  : isDragOver
                    ? '释放文件以导入'
                    : '支持 PDF / Word / TXT，可拖拽文件到此处'}
              </span>
            </div>

            {isParsing && (
              <p className="text-xs text-sub flex items-center gap-2">
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
                <p className="text-xs text-sub">首次导入 PDF/Word 需下载解析组件（约 4MB，仅需一次）。</p>
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
                  <span className="text-xs text-[color:var(--vg-cyan)]">✅ 已解析 {documentText.length} 字</span>
                  <button
                    type="button"
                    onClick={() => setShowFilePreview(!showFilePreview)}
                    className="text-xs text-sub hover:text-sub"
                  >
                    {showFilePreview ? '收起' : '预览'}
                  </button>
                </div>
                {showFilePreview && (
                  <div className="mt-2 p-3 rounded-lg bg-surface border border-line text-xs text-sub max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {documentText.slice(0, 500)}
                    {documentText.length > 500 && '...'}
                  </div>
                )}
              </div>
            )}
          </div>
        </details>
      )}

      {/* Web search checkbox — create mode only */}
      {!isEdit && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enableWebSearch}
            onChange={(e) => setEnableWebSearch(e.target.checked)}
            className="w-4 h-4 rounded border-line-strong bg-surface text-[color:var(--vg-accent)] focus:ring-gene-purple/30"
          />
          <span className="text-sm text-sub">启用联网搜索</span>
        </label>
      )}

      {!isEdit && <div className="grid grid-cols-2 gap-3 items-start">
      {!isEdit && <button type="button" disabled={styleBusy || !name.trim() || !(description.trim() || filledCount || learnedStyle?.rules.trim())} onClick={() => {
        setSystemPrompt([`你是${name.trim()}。`, ...STEP_FIELDS.filter(field => !["speechStyle", "speechExamples", "boundaries"].includes(field.key)).map(field => fields[field.key].trim() && `${field.title}：${fields[field.key].trim()}`), description.trim()].filter(Boolean).join('\n'));
        setBoundaries(fields.boundaries.trim()); setCandidates(null); goStep(2);
      }} className="vg-button vg-button-secondary w-full">直接使用我的设定</button>}
      {/* Generate button — create mode only */}
      {!isEdit && (
        <div>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
            aria-busy={isGenerating}
            className="vg-button vg-button-primary w-full"
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
                </svg>
                塑造中…
              </>
            ) : (
              systemPrompt ? '重新塑造 TA' : '塑造 TA 的性格'
            )}
          </button>
        </div>
      )}
      </div>}
      </div>
      <div data-create-step className={isEdit ? "vg-editor-card space-y-5" : "space-y-5"} hidden={step !== (isEdit ? 3 : 4)}>
      {!isEdit && !candidates && <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4">
        <span className="w-12 h-12 shrink-0 rounded-full flex items-center justify-center overflow-hidden text-lg" style={{background:'var(--vg-action)',color:'var(--vg-on-action)'}}>{avatarImageSrc(avatar) ? <img src={avatarImageSrc(avatar)} alt="" className="w-full h-full object-cover"/> : name.trim().slice(0,1) || <Icon name="profile" size={24}/>}</span>
        <div className="min-w-0"><p className="text-lg font-semibold text-ink break-words">{name.trim() || '还没取名的 TA'}</p><p className="text-sm text-sub break-words">{signature || fields.identity || '设定由你决定，准备好后再保存。'}</p></div>
      </div>}
      {!isEdit && !systemPrompt && !candidates && <p className="text-sm text-sub">还没有完整人物设定。<button type="button" className="vg-button vg-button-ghost" onClick={() => goStep(1)}>返回性格页继续填写</button></p>}
      {/* Candidate comparison — create mode only, before picking */}
      {!isEdit && candidates && (
        <div className="space-y-2">
          <p className="text-sm text-sub">听听不同的 TA，选一个最契合的：</p>
          <div className="grid grid-cols-1 gap-3">
            {candidates.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handlePickCandidate(c)}
                className="text-left p-3 rounded-xl border border-line hover:border-gene-purple hover:bg-gene-purple/5 transition-colors"
              >
                <div className="text-xs text-[color:var(--vg-cyan)] mb-1">候选 {i + 1}</div>
                <div className="flex flex-wrap gap-1">
                  {c.tags.map((t) => (
                    <span key={t} className="text-xs px-2 py-1 rounded bg-gene-purple/10 text-[color:var(--vg-accent)]">
                      {t}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-sm text-ink">{c.signature}</p>
                <p className="mt-2 text-sm leading-relaxed text-sub">“{c.greeting}”</p>
                <p className="mt-2 text-xs text-sub line-clamp-3">{c.systemPrompt}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {!isEdit && !candidates && <section className="space-y-3">
        {greeting && <p className="text-sm text-sub">{greeting}</p>}
        <label className="block text-sm text-sub">试聊一句
          <input value={previewInput} onChange={e => { if (previewController.current) stopPreview('试聊内容已更新，已停止之前的回应。'); setPreviewInput(e.target.value); draftEpoch.current++; setPreviewReply(''); }}
            className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" /></label>
        <div className="flex justify-end"><button type="button" disabled={!canSave || previewBusy || isGenerating || !previewInput.trim()} onClick={tryConversation}
          className="vg-button vg-button-secondary" style={{background:'transparent',borderColor:'var(--vg-accent)',color:'var(--vg-accent)'}}>{previewBusy ? 'TA 正在回应…' : '试着聊两句'}</button></div>
        {previewReply && <p className="rounded-xl bg-panel p-3 text-sm leading-relaxed text-ink whitespace-pre-wrap">{previewReply}</p>}
        {previewError && <p role="alert" className="text-sm text-red-400">{previewError}</p>}
        <p className="text-xs text-sub">试聊使用当前模型，不会保存到聊天或记忆；也可以跳过。</p>
      </section>}

      {/* Generated result — editable fields */}
      {((!isEdit && systemPrompt && !candidates) || isEdit) && (
        <details open={isEdit || undefined} className="rounded-xl border border-line p-4 space-y-4">
          <summary className="cursor-pointer text-sm font-medium text-ink">{isEdit ? "深入塑造 · 人物设定与表达" : "完整人物设定"}</summary>
          {/* Tags */}
          <div>
            <p className="text-sm text-sub mb-1.5">性格标签</p>
            <TagInput value={tags} onChange={setTags} suggestions={PERSONALITY_TAGS} label="性格标签" placeholder="输入性格，回车添加" />
          </div>

          {/* Signature & greeting — edit mode only */}
          {isEdit && (
            <>
              <div>
                <label htmlFor={`${formId}-signature`} className="block text-sm text-sub mb-1.5">一句话签名</label>
                <input
                  id={`${formId}-signature`}
                  type="text"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="凝练这个灵魂的一句话"
                  className="w-full px-4 py-3 bg-surface border border-line-strong rounded-xl text-sm text-ink placeholder-gray-500 transition-colors"
                />
              </div>

              <div>
                <label htmlFor={`${formId}-greeting`} className="block text-sm text-sub mb-1.5">示例开场白</label>
                <input
                  id={`${formId}-greeting`}
                  type="text"
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                  placeholder="TA 主动开口说的第一句话"
                  className="w-full px-4 py-3 bg-surface border border-line-strong rounded-xl text-sm text-ink placeholder-gray-500 transition-colors"
                />
              </div>

              <div>
                <label htmlFor={`${formId}-catchphrase`} className="block text-sm text-sub mb-1.5">口头禅（可选）</label>
                <input
                  id={`${formId}-catchphrase`}
                  type="text"
                  value={catchphrase}
                  onChange={(e) => setCatchphrase(e.target.value)}
                  placeholder="如：啧 / 有趣 / 你说呢（角色偶尔自然使用）"
                  className="w-full px-4 py-3 bg-surface border border-line-strong rounded-xl text-sm text-ink placeholder-gray-500 transition-colors"
                />
              </div>
            </>
          )}

          {/* System prompt */}
          <div>
            <label htmlFor={`${formId}-prompt`} className="block text-sm text-sub mb-1.5">
              人物设定
            </label>
            <textarea
              id={`${formId}-prompt`}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={isEdit ? '' : '点击上方按钮生成基因序列，或手动输入...'}
              rows={4}
              className="w-full px-4 py-3 bg-surface border border-line-strong rounded-xl text-sm text-ink placeholder-gray-500 transition-colors resize-none"
            />
          </div>
          <label className="block text-sm text-sub">互动边界（可选）
            <textarea value={boundaries} onChange={e=>setBoundaries(e.target.value)} rows={3} placeholder="哪些话题需要谨慎？希望 TA 如何尊重你的选择？" className="mt-2 w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink" />
          </label>
        </details>
      )}
      {isEdit && !isSecretary && <VoiceSamplesEditor character={{ ...editCharacter, name: name.trim(), systemPrompt: composedPrompt(), tags, signature: signature.trim(), greeting: greeting.trim(), catchphrase: catchphrase.trim() || undefined, boundaries: boundaries.trim() || undefined }} value={voiceSamples} onChange={setVoiceSamples} disabled={isSaving || styleBusy} />}
      {isEdit && !isSecretary && <GreetingReview character={{ ...editCharacter, name: name.trim(), systemPrompt: composedPrompt(), tags, signature: signature.trim(), greeting: greeting.trim(), catchphrase: catchphrase.trim() || undefined, boundaries: boundaries.trim() || undefined }} onAdopt={setGreeting} disabled={isSaving || styleBusy} />}
      {isEdit && !isSecretary && !editCharacter.isPreset && !editCharacter.published && editCharacter.createdBy === userId && <button type="button" className="min-h-11 text-sm text-[color:var(--vg-accent)]" onClick={() => setShowSpeechSamples(true)}>管理采用的表达样本</button>}
      {showSpeechSamples && editCharacter && <ReviewedSpeechModal key={`${userId}:${editCharacter.id}`} character={editCharacter} onClose={() => setShowSpeechSamples(false)} />}

      {/* Publish to gene pool */}
      {!isEdit && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="w-4 h-4 rounded border-line-strong bg-surface text-[color:var(--vg-accent)] focus:ring-gene-purple/30"
          />
          <span className="text-sm text-sub">发布到基因库（可选）</span>
        </label>
      )}
      {isEdit && editCharacter.published && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="w-4 h-4 rounded border-line-strong bg-surface text-[color:var(--vg-accent)] focus:ring-gene-purple/30"
          />
          <span className="text-xs text-sub">已发布到基因库（取消勾选将撤回）</span>
        </label>
      )}

      </div>
      </fieldset>
      {saveError && <FeedbackNotice tone="error" message={saveError} />}
      {footerTarget ? createPortal(footer, footerTarget) : footer}
    </div>
  );
}
