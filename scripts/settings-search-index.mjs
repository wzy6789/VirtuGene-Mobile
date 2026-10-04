import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const folder=resolve(root,'src/components/settings');
const sourceOf=file=>ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const collect=(node,labels)=>{
  const visit=n=>{
    if(ts.isJsxText(n)) { const text=n.text.replace(/\s+/g,' ').trim(); if(text) labels.add(text); }
    if(ts.isJsxAttribute(n)&&['title','detail','label','scope','placeholder','aria-label'].includes(n.name.getText())) {
      const value=n.initializer;
      if(value&&ts.isStringLiteral(value)) labels.add(value.text);
      else if(value&&ts.isJsxExpression(value)&&value.expression&&ts.isStringLiteral(value.expression)) labels.add(value.expression.text);
    }
    // Options and grouped rows often obtain labels from a local descriptor array.
    if(ts.isPropertyAssignment(n)&&['title','detail','label'].includes(n.name.getText())&&ts.isStringLiteral(n.initializer)) labels.add(n.initializer.text);
    ts.forEachChild(n,visit);
  }; visit(node);
};

/** Index static UI labels at build time. Never mount forms or read user values. */
export function updateSettingsSearchIndex() {
  const source=sourceOf(resolve(folder,'SettingsPanel.tsx'));
  const imports=new Map();
  for(const statement of source.statements) {
    if(!ts.isImportDeclaration(statement)||!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier=statement.moduleSpecifier.text;
    if(!specifier.startsWith('./')||specifier.includes('SettingsUI')||specifier.includes('settings-')) continue;
    const bindings=statement.importClause?.namedBindings;
    if(bindings&&ts.isNamedImports(bindings)) for(const item of bindings.elements) imports.set(item.name.text,resolve(folder,specifier+'.tsx'));
  }
  const index={};
  const visit=node=>{
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken&&ts.isBinaryExpression(node.left)&&node.left.left.getText(source)==='page'&&ts.isStringLiteral(node.left.right)) {
      const page=node.left.right.text;
      if(page!=='home') {
        const labels=new Set(index[page]??[]); collect(node.right,labels);
        const seen=new Set();
        const addComponent=file=>{
          if(seen.has(file)) return; seen.add(file);
          const component=sourceOf(file); collect(component,labels);
          for(const statement of component.statements) {
            if(!ts.isImportDeclaration(statement)||!ts.isStringLiteral(statement.moduleSpecifier)) continue;
            const specifier=statement.moduleSpecifier.text;
            if(!specifier.startsWith('./')||specifier.includes('SettingsUI')||specifier.includes('settings-')||!statement.importClause?.namedBindings||!ts.isNamedImports(statement.importClause.namedBindings)) continue;
            const used=new Set(); const scan=n=>{if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)) used.add(n.tagName.getText(component)); ts.forEachChild(n,scan);}; scan(component);
            if(statement.importClause.namedBindings.elements.some(item=>used.has(item.name.text))) addComponent(resolve(dirname(file),specifier+'.tsx'));
          }
        };
        const find=n=>{if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){const file=imports.get(n.tagName.getText(source));if(file)addComponent(file);}ts.forEachChild(n,find);};find(node.right);
        index[page]=[...labels];
      }
    }
    ts.forEachChild(node,visit);
  }; visit(source);
  const result=Object.fromEntries(Object.entries(index).sort().map(([page,labels])=>[page,labels.join(' ')]));
  const output='// Generated from static settings component labels by scripts/settings-search-index.mjs.\nexport const settingsLabelIndex: Record<string,string> = '+JSON.stringify(result,null,2)+';\n';
  const target=resolve(folder,'settings-label-index.ts');
  let previous=''; try{previous=readFileSync(target,'utf8');}catch{}
  if(previous!==output) writeFileSync(target,output);
  return result;
}

export function settingsSearchIndexPlugin() {
  return {name:'virtugene-settings-search-index',buildStart(){updateSettingsSearchIndex();},handleHotUpdate({file}){if(resolve(file).startsWith(folder)&&!file.endsWith('settings-label-index.ts'))updateSettingsSearchIndex();}};
}
