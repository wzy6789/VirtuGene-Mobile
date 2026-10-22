import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const out='.tmp-preview/ui-overhaul-20261016/memory-startup-boundary';
const declarations=(path)=>{const source=fs.readFileSync(path,'utf8'),ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);return ast.statements.filter(n=>ts.isFunctionDeclaration(n)||ts.isVariableStatement(n)).map(n=>n.getText(ast).replace(/^export\s+/,'').replaceAll('\r\n','\n'));};
const before=declarations(out+'/before-src/memory-repo.ts'),after=[...declarations('src/db/memory-repo.ts'),...declarations('src/db/memory-invalidation.ts')];
const checks=[];for(const declaration of before){assert.ok(after.includes(declaration),'original memory declaration changed: '+declaration.slice(0,90));checks.push(declaration.match(/(?:function|const)\s+(\w+)/)?.[1]);}
assert.equal(after.length,before.length);
for(const name of ['session-repo.ts','message-repo.ts','session-summary-repo.ts']){assert.deepEqual(declarations('src/db/'+name),declarations(out+'/before-src/'+name),name+' implementation changed');checks.push(name+' all implementations byte-identical');}
const chat=fs.readFileSync('src/store/chat-store.ts','utf8'),method=chat.slice(chat.indexOf('deleteCharacterWithSessions: async'));
assert.ok(method.indexOf("loadForAccount(userId, () => import('../db/memory-repo'))")<method.indexOf("db.transaction('rw'"),'repository loaded before atomic deletion transaction');checks.push('repository loads before transaction');
fs.writeFileSync(out+'/source-parity.json',JSON.stringify({status:'pass',checks,scope:'Exact top-level implementation text, ignoring import/re-export locations and export keyword. Does not replace runtime/account/transaction tests.'},null,2));console.log(JSON.stringify({status:'pass',checks:checks.length}));
