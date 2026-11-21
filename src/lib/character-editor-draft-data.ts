import type { ChatStyleProfile } from './chat-style-import';
import type { VoiceSamples } from './character-voice';
import { migrateCharacterCreateStep } from './character-editor-steps';

type Field = 'identity' | 'personality' | 'speechStyle' | 'speechExamples' | 'boundaries' | 'supplement';
export interface CharacterDraftValues {
  name: string; avatar: string; systemPrompt: string; tags: string[];
  learnedStyle?: ChatStyleProfile; voiceSamples?: VoiceSamples; importedMemories: string[];
  signature: string; greeting: string; catchphrase: string; boundaries: string; published: boolean;
  personality: string; secretaryPreferences: string; userIdentity: string; userRelationship: string;
  alreadyKnow: boolean; sharedPast: string; fields: Record<Field, string>; description: string;
  documentText: string | null; selectedFile: { name: string; path: string } | null;
}
export interface CharacterDraftData {
  version: 2; values: CharacterDraftValues;
  relationshipTargets: string[]; relationshipMeta: Record<string, { label: string; description: string }>;
  expectedCharacter: string | null; expectedRelations: string;
  initialSnapshot: string; relationBaseline: string;
  step: number; mode: 'simple' | 'guided'; enableWebSearch: boolean; previewInput: string;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

/** A corrupt/unsupported local row never flows into controlled form fields. */
export function readCharacterDraftData(raw: string): CharacterDraftData {
  if (raw.length > 8_000_000) throw Error('draft:invalid');
  const value: unknown = JSON.parse(raw);
  if (!record(value) || ![1,2].includes(value.version as number) || !record(value.values)) throw Error('draft:invalid');
  const v = value.values;
  if (!['name','avatar','systemPrompt','signature','greeting','catchphrase','boundaries','personality','secretaryPreferences','userIdentity','userRelationship','sharedPast','description'].every(key => typeof v[key] === 'string')
    || !strings(v.tags) || !strings(v.importedMemories) || typeof v.published !== 'boolean' || typeof v.alreadyKnow !== 'boolean'
    || !record(v.fields) || !['identity','personality','speechStyle','speechExamples','boundaries','supplement'].every(key => typeof (v.fields as Record<string, unknown>)[key] === 'string')
    || !(v.documentText === null || typeof v.documentText === 'string')
    || !(v.selectedFile === null || record(v.selectedFile) && typeof v.selectedFile.name === 'string' && typeof v.selectedFile.path === 'string')
    || !(v.learnedStyle === undefined || record(v.learnedStyle) && typeof v.learnedStyle.rules === 'string' && strings(v.learnedStyle.examples))
    || !(v.voiceSamples === undefined || record(v.voiceSamples) && strings(v.voiceSamples.lines) && Number.isFinite(v.voiceSamples.generatedAt) && Number.isFinite(v.voiceSamples.promptRevision))
    || !strings(value.relationshipTargets) || !record(value.relationshipMeta)
    || !Object.values(value.relationshipMeta).every(meta => record(meta) && typeof meta.label === 'string' && typeof meta.description === 'string')
    || !(value.expectedCharacter === null || typeof value.expectedCharacter === 'string')
    || !['expectedRelations','initialSnapshot','relationBaseline','previewInput'].every(key => typeof value[key] === 'string')
    || !Number.isInteger(value.step) || (value.step as number) < 0 || (value.step as number) > (value.version === 1 ? 3 : 4)
    || value.expectedCharacter !== null && (value.step as number) > 3
    || !['simple','guided'].includes(value.mode as string) || typeof value.enableWebSearch !== 'boolean') throw Error('draft:invalid');
  return { ...value, version: 2, step: value.expectedCharacter === null ? migrateCharacterCreateStep(value.step as number, value.version as number) : value.step } as unknown as CharacterDraftData;
}
