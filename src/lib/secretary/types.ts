import type { Diary, Todo, TodoOccurrence, MomentVisibility } from '../../db';
import type { SecretaryPersonality } from './personality';
import type { SecretaryWorkPreferences } from './work-preferences';

export type SecretaryActionKind = 'diary.save' | 'diary.search' | 'moment.draft' | 'moment.publish' | 'moment.search' | 'todo.create' | 'todo.list' | 'todo.complete' | 'todo.reopen' | 'todo.reschedule' | 'todo.update' | 'todo.cancel' | 'todo.steps' | 'app.open' | 'character.message.send';
export type SecretaryDestination = 'diary' | 'todo' | 'moments' | 'memory' | 'timeline' | 'relations' | 'stage' | 'worldSettings';
export interface SecretaryAction {
  kind: SecretaryActionKind;
  title?: string;
  content?: string;
  date?: string;
  endDate?: string;
  statusFilter?: 'pending' | 'completed' | 'all';
  time?: string;
  targetId?: string;
  query?: string;
  reminder?: boolean;
  recurrence?: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'interval';
  intervalDays?: number;
  priority?: 'normal' | 'important' | 'urgent';
  reminderMinutes?: number[];
  destination?: SecretaryDestination;
  visibility?: MomentVisibility;
  audienceIds?: string[];
  steps?: string[];
  stepMode?: 'add' | 'complete' | 'reopen';
  stepIndex?: number;
  stepQuery?: string;
}
export interface SecretaryResult {
  dispatch?: import('./character-messaging').CharacterDispatch;
  instruction?: import('./operation-contract').OperationContract;
  planningError?: string;
  action: SecretaryAction;
  status: 'pending' | 'done' | 'draft' | 'needs-input' | 'failed' | 'undone';
  label: string;
  detail?: string;
  targetId?: string;
  targetDate?: string;
  afterVersion?: number;
  afterTodoVersion?: number;
  afterDiaryRevision?: number;
  publicationApproved?: boolean;
  reviewApproved?: boolean;
  selectionApproved?: boolean;
  stepSelectionApproved?: boolean;
  editApproved?: boolean;
  sourceTaskId?: string;
  sourceResultIndex?: number;
  sourceMode?: 'continue' | 'list-item' | 'todo-edit';
  sourceUpdatedAt?: number;
  sourceMessageRevision?: number;
  sourceTargetDate?: string;
  authorizationMessageId?: string;
  authorizationRequest?: string;
  expectedTargetVersion?: number;
  operationId?: string;
  beforeDiary?: Diary;
  beforeTodo?: Todo;
  beforeOccurrence?: TodoOccurrence;
  candidates?: { id: string; label: string; date?: string; version?: number }[];
  todoRows?: { id: string; title: string; date: string; time?: string; completed: boolean; version?: number; stepsDone?: number; stepsTotal?: number }[];
  recordRows?: { id: string; title: string; date: string; excerpt: string; version: number }[];
  stepCandidates?: { index: number; title: string }[];
}
export interface SecretaryTask {
  id: string;
  userId: string;
  characterId: string;
  sessionId: string;
  messageId: string;
  request: string;
  /** Locally checked provenance; absent on old records, which remain protected. */
  privacyScope?: 'plain' | 'diary' | 'unknown';
  status: 'planning' | 'ready' | 'finished' | 'failed';
  /** Safe local explanation; contains no raw provider payload or credentials. */
  failureReason?: string;
  reply?: string;
  /** Validated emotion/intent only; execution facts never come from this contract. */
  planningContract?: import('./planning-contract').SecretaryPlanningContract;
  /** Persistent missing-field context, including every user source and its revision. */
  pendingContext?: import('./pending-context').SecretaryPendingContext;
  continuationQuestion?: string;
  /** Display the next real focus in this reply when its original chat is elsewhere. */
  continuationFocus?: { taskId: string; version: number };
  personality?: SecretaryPersonality;
  /** The habits in effect when the user initiated this request. */
  workPreferences?: SecretaryWorkPreferences;
  /** Only references actually supplied to the planner; no private text duplication. */
  memoryReferences?: import('./memory').SecretaryMemoryReferences;
  memoryNotice?: string;
  rememberedMemoryIds?: string[];
  employmentId?: string;
  assistantName?: string;
  dailyReview?: DailyReviewOptions;
  reviewSources?: DailyReviewSources;
  results: SecretaryResult[];
  leaseUntil?: number;
  createdAt: number;
  updatedAt: number;
}

export interface DailyReviewOptions {
  date: string;
  includeDiary: boolean;
  includeTodos: boolean;
  notes: string;
  /** Omitted by older requests: generate all three suggestion types. */
  outputs?: DailyReviewOutput[];
}
export type DailyReviewOutput = 'diary' | 'moment' | 'todos';
export interface DailyReviewSources {
  diaries: { id: string; version: number }[];
  todos: { id: string; version: number; occurrenceId?: string; occurrenceVersion?: number }[];
}
