import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const file = 'src/components/chat/EmotionPanel.tsx';
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['isEmotionSessionScope', 'scopeEmotionSnapshots'];
const functions = names.map(name => source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name));
assert.ok(functions.every(Boolean), 'emotion detail exposes actual session authorization and snapshot scoping');
const code = ts.transpileModule(functions.map(node => node.getText(source)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { isEmotionSessionScope, scopeEmotionSnapshots } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const role = { id: 'role-a', createdBy: 'owner-a', isPreset: false };
const session = { id: 'session-a', userId: 'owner-a', characterId: 'role-a' };
assert.equal(isEmotionSessionScope(role, session, 'owner-a', 'role-a'), true);
for (const [character, conversation, owner] of [[role, session, 'owner-b'], [{ ...role, isPreset: true }, session, 'owner-a'], [{ ...role, createdBy: 'owner-b' }, session, 'owner-a'], [role, { ...session, characterId: 'role-b' }, 'owner-a'], [role, { ...session, type: 'group' }, 'owner-a'], [undefined, session, 'owner-a'], [role, undefined, 'owner-a']]) {
  assert.equal(isEmotionSessionScope(character, conversation, owner, 'role-a'), false);
}
const rows = [
  { id: 'old', characterId: 'role-a', sessionId: 'session-a', createdAt: 1 },
  { id: 'new', characterId: 'role-a', sessionId: 'session-a', createdAt: 5 },
  { id: 'other-role', characterId: 'role-b', sessionId: 'session-a', createdAt: 8 },
  { id: 'other-session', characterId: 'role-a', sessionId: 'session-b', createdAt: 9 },
];
assert.deepEqual(scopeEmotionSnapshots(rows, 'role-a', 'session-a').map(row => row.id), ['new', 'old']);
console.log('PASS: current owner/private role/session authorization; no cross-role or cross-session trend');
