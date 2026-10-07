import React from 'react';
import { createRoot } from 'react-dom/client';
import { db, type Message } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useUIStore } from '../../src/store/ui-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { createSecretary } from '../../src/lib/secretary/character';
import { runSecretaryRequest, undoSecretaryAction } from '../../src/lib/secretary/agent';
import { todoRepo, localDateKey, addLocalDays } from '../../src/db/todo-repo';
import { readActionDay } from '../../src/lib/action-cabin/query';
import { readConversationTodo, todoConversationContext } from '../../src/lib/secretary/workspace-todo';
import { SecretaryHubPage } from '../../src/components/secretary/SecretaryHubPage';
import { SecretaryWorkspaceCard } from '../../src/components/secretary/SecretaryWorkspaceCard';
import '../../src/styles/assistant-hub.css';

const root = createRoot(document.getElementById('root')!);
const uid = 'hub-owner', day = localDateKey(), tomorrow = addLocalDays(day, 1);
let assistantId = '', sessionId = '', selectedId = '', calls = 0, checks = 0;
let actions: any[] = [], responseWait: Promise<void> | undefined, release: (() => void) | undefined;
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (!String(input).includes('/chat/completions')) return realFetch(input, init);
  calls++;
  const body = JSON.parse(String(init?.body));
  const text = body.messages.find((m: any) => m.role === 'user')?.content.match(/当前用户请求：([^\n]*)/)?.[1] ?? '';
  const plan = { actions: actions.map(a => ({ ...a, evidence: { text } })), reply: actions.length ? '' : '我在，继续说。' };
  if (responseWait) { await responseWait; responseWait = undefined; }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
};
const auth = (userId = uid) => useAuthStore.setState({ userId, username: '整合验收', isLoggedIn: true, apiKey: 'test-key' });
function check(value: unknown, label: string) { if (!value) throw new Error(label); checks++; }
async function rejects(work: () => Promise<unknown>, label: string) { let failed = false; try { await work(); } catch { failed = true; } check(failed, label); }
async function seed() {
  await db.open();
  await Promise.all(db.tables.map(table => table.clear()));
  auth(); useSettingsStore.setState({ diaryPin: null });
  const assistant = await createSecretary(uid, '用户起的名字'); assistantId = assistant.id;
  sessionId = `hub-session:${uid}`;
  await db.sessions.put({ id: sessionId, characterId: assistantId, userId: uid, title: assistant.name, type: 'single', modelAsked: true, createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0 });
  useChatStore.setState({ characters: [assistant], selectedCharacterId: assistantId, currentSessionId: sessionId, messages: [] });
  selectedId = (await todoRepo.create({ userId: uid, title: '每日提交方案', dueDate: day, dueTime: '23:59', recurrence: { kind: 'daily' }, priority: 'important', visibility: 'private' })).id;
  await todoRepo.create({ userId: uid, title: '还没排期的想法', recurrence: { kind: 'none' }, priority: 'normal', visibility: 'private' });
  useUIStore.setState({ activeView: 'actionCabin', assistantTab: 'today', chatFromList: false, chatFromCharacters: false });
  actions = []; calls = 0;
}
async function currentContext() {
  const row = (await readActionDay(uid)).pending.find(row => row.todo.id === selectedId && row.occurrence.scheduledDate === day)!;
  return todoConversationContext(row);
}
async function request(text: string, plan: any[], context?: Awaited<ReturnType<typeof currentContext>>) {
  context ??= await currentContext();
  actions = plan;
  const message: Message = { id: crypto.randomUUID(), sessionId, role: 'user', content: text, createdAt: Date.now(), isProactive: false, secretaryTodoContext: context };
  await db.messages.add(message);
  return runSecretaryRequest(uid, assistantId, message);
}
async function dataChecks() {
  await seed(); checks = 0;
  const baseline = await readActionDay(uid);
  check(baseline.focus.length === 1 && baseline.focus[0].todo.id === selectedId, 'today priorities do not backfill empty slots with unplanned ideas');
  check(baseline.pending.some(row => row.occurrence.dueDate === '9999-12-31'), 'unplanned ideas remain in pending data');
  const scope = 'hub-focus-boundary';
  const unplanned = await todoRepo.create({ userId: scope, title: '未排期重点', recurrence: { kind: 'none' }, priority: 'urgent', focusDate: day, visibility: 'private' });
  const future = await todoRepo.create({ userId: scope, title: '未来安排', dueDate: tomorrow, recurrence: { kind: 'none' }, priority: 'urgent', visibility: 'private' });
  check((await readActionDay(scope)).focus.length === 0, 'unplanned focus marks and unmarked future dates do not become today priorities');
  const explicitToday = await todoRepo.create({ userId: scope, title: '今天提前做', dueDate: tomorrow, focusDate: day, recurrence: { kind: 'none' }, priority: 'normal', visibility: 'private' });
  check((await readActionDay(scope)).focus[0]?.todo.id === explicitToday.id, 'a dated future item explicitly marked for today remains eligible');
  const overdue = await todoRepo.create({ userId: scope, title: '逾期需处理', dueDate: addLocalDays(day, -1), recurrence: { kind: 'none' }, priority: 'important', visibility: 'private' });
  const priorities = await readActionDay(scope);
  check(priorities.focus[0]?.todo.id === overdue.id && priorities.focus.length === 2, 'dated overdue priorities are preserved without inbox or future filler');
  await db.todos.bulkDelete([unplanned.id, future.id, explicitToday.id, overdue.id]);
  let context = await currentContext();
  const focused = await request('把这件事设为今日重点', [{ kind: 'todo.update', focusDate: day }]);
  check(focused.results[0].status === 'done', 'contextual focus request commits');
  check((await readConversationTodo(uid, context, false)).occurrence.focusDate === day, 'focus stored on selected occurrence');
  check((await db.todos.get(selectedId))?.focusDate == null, 'focus never changes repeating template');
  await rejects(() => readConversationTodo(uid, context), 'old context detects a newer occurrence');
  await undoSecretaryAction(uid, focused.id, 0);
  check((await readConversationTodo(uid, context, false)).occurrence.focusDate == null, 'focus undo restores prior effective state');
  context = await currentContext();
  const moved = await request('把这件事改到明天下午三点', [{ kind: 'todo.reschedule', date: tomorrow, time: '15:00' }], context);
  check(moved.results[0].status === 'done', 'repeating occurrence can be rescheduled through conversation');
  check((await readConversationTodo(uid, context, false)).occurrence.dueDate === tomorrow, 'only selected occurrence deadline moved');
  check((await db.todos.get(selectedId))?.dueDate === day, 'recurring anchor never moved');
  check((await readActionDay(uid)).today.length === 0, 'shared today count sees conversational reschedule');
  await undoSecretaryAction(uid, moved.id, 0);
  check((await readActionDay(uid)).today.length === 1, 'undo returns item to shared today count');
  const waited = await request('把这件事设为等待客户反馈，明天跟进', [{ kind: 'todo.update', workStatus: 'waiting', waitingFor: '客户', followupDate: tomorrow }]);
  check(waited.results[0].status === 'done', 'waiting plan is executable');
  check((await db.todoEvents.toArray()).some(e => e.kind === 'followup-planned'), 'followup plan creates planning event');
  check(!(await db.todoEvents.toArray()).some(e => e.kind === 'followup-recorded'), 'planning never invents contact');
  await undoSecretaryAction(uid, waited.id, 0);
  const cross = await request('把这件事设为今日重点', [{ kind: 'todo.update', targetId: 'someone-else', focusDate: day }]);
  check(cross.results[0].status === 'needs-input', 'model cannot escape selected task');
  const negative = await request('不要把这件事设为今日重点', [{ kind: 'todo.update', focusDate: day }]);
  check(negative.results[0].status === 'needs-input', 'negative instruction cannot write focus');
  const reported = await request('同事说把这件事设为今日重点', [{ kind: 'todo.update', focusDate: day }]);
  check(reported.results[0].status === 'needs-input', 'selected task context never turns reported speech into authorization');
  const guessed = await request('把这件事设为进行中', [{ kind: 'todo.update', workStatus: 'doing', waitingFor: '模型虚构对象' }]);
  check(guessed.results[0].status === 'needs-input', 'work fields require user facts');
  const series = await request('修改这件待办名称', [{ kind: 'todo.update', title: '错误改名' }]);
  check(series.results[0].status === 'needs-input' && (await db.todos.get(selectedId))?.title === '每日提交方案', 'instance selection does not authorize series editing');
  const focusedAgain = await request('把这件事设为今日重点', [{ kind: 'todo.update', focusDate: day }]);
  context = await currentContext();
  await todoRepo.updateOccurrence(uid, selectedId, day, { blockedReason: '后续操作' }, context.occurrenceVersion);
  await rejects(() => undoSecretaryAction(uid, focusedAgain.id, 0), 'old conversational undo cannot overwrite a subsequent edit');
  context = await currentContext();
  const invalidated = await todoRepo.updateOccurrence(uid, selectedId, day, { blockedReason: '后来修改' }, context.occurrenceVersion);
  await rejects(() => request('把这件事设为今日重点', [{ kind: 'todo.update', focusDate: day }], context), 'old selected source cannot be executed');
  await todoRepo.undoOccurrence(uid, invalidated!);
  context = await currentContext(); auth('hub-other');
  await rejects(() => readConversationTodo('hub-other', context), 'foreign context excluded after account change');
  auth();
  // Replaying a completed request stays idempotent after its selected source changes.
  const complete = await request('这件事完成了', [{ kind: 'todo.complete' }]);
  check(complete.results[0].status === 'done', 'selected occurrence completion is real');
  const count = await db.todoEvents.count();
  const replay = await runSecretaryRequest(uid, assistantId, (await db.messages.get(complete.messageId))!);
  check(replay.id === complete.id && await db.todoEvents.count() === count, 'finished request replay does not execute again');
  return { checks };
}
function Router() {
  const view = useUIStore(s => s.activeView);
  return <div className="mobile-layout" style={{ height: '100vh' }}>{view === 'actionCabin' ? <SecretaryHubPage /> : <SecretaryWorkspaceCard />}</div>;
}
(window as any).hubTest = { db, auth, dataChecks, seed, currentContext, useUIStore, useChatStore,
  mount: async () => { await seed(); root.render(<Router />); },
  setPlan: (plan: any[]) => { actions = plan; },
  hold: () => { responseWait = new Promise(resolve => { release = resolve; }); }, release: () => release?.(),
  calls: () => calls, day, tomorrow, selected: () => selectedId,
  noApi: () => useAuthStore.setState({ apiKey: null }),
};
