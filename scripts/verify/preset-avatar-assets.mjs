import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const root='.tmp-preview/ui-overhaul-20261016/preset-avatar-assets',files=['src/lib/seed-init.ts','src/lib/practical-avatars.ts','src/lib/lu-xue-qi-avatar.ts'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const readAst=(file,source)=>ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
const strings=(file,source)=>{const values=[];const ast=readAst(file,source);function visit(n){if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))values.push(n.text);ts.forEachChild(n,visit);}visit(ast);return values;};
if(process.argv.includes('--capture')){
 if(fs.existsSync(root+'/portraits.json'))throw Error('Do not overwrite the captured original portraits.');
 fs.mkdirSync(root+'/before',{recursive:true});const portraits=[];
 for(const file of files){const source=fs.readFileSync(file,'utf8'),ast=readAst(file,source);fs.writeFileSync(root+'/before/'+path.basename(file),source);
  function visit(n){if(ts.isStringLiteral(n)&&n.text.startsWith('data:image/')){
   let id;
   if(file.endsWith('practical-avatars.ts'))id='preset-'+n.parent.name.getText(ast);
   else if(file.endsWith('lu-xue-qi-avatar.ts'))id='preset-luxueqi';
   else {const object=n.parent.parent;id=object.properties.find(p=>p.name?.getText(ast)==='id')?.initializer?.text;}
   assert.ok(id,'Every bundled portrait has a known preset owner');
   const [header,data]=n.text.split(','),bytes=Buffer.from(data,'base64');assert.equal(header,'data:image/jpeg;base64');
   portraits.push({id,file,identity:'preset-avatar:'+id,asset:'src/assets/presets/'+id+'.jpg',bytes:bytes.length,sha256:sha(bytes)});
  }ts.forEachChild(n,visit);}visit(ast);
 }
 fs.writeFileSync(root+'/portraits.json',JSON.stringify(portraits,null,2));console.log(JSON.stringify({portraits:portraits.length,bytes:portraits.reduce((s,p)=>s+p.bytes,0)}));
}else{
 const portraits=JSON.parse(fs.readFileSync(root+'/portraits.json','utf8')),checks=[];
 for(const file of files){const before=fs.readFileSync(root+'/before/'+path.basename(file),'utf8'),after=fs.readFileSync(file,'utf8');
  const images=strings(file,before).filter(s=>s.startsWith('data:image/'));
  assert.equal(strings(file,after).filter(s=>s.startsWith('data:image/')).length,0,file+' must no longer put image bytes inside JavaScript');checks.push(file+' image payload removed from JS');
  // This intentionally checks every unrelated source byte, including migration bodies.
  let normalized=after;for(const image of images){const hash=sha(Buffer.from(image.split(',')[1],'base64')),portrait=portraits.find(p=>p.file===file&&p.sha256===hash);assert.ok(portrait);normalized=normalized.replace(portrait.identity,image);}
  assert.equal(normalized,before,file+' unrelated preset and migration source remains exactly unchanged');checks.push(file+' all non-avatar source bytes unchanged');
 }
 for(const portrait of portraits){assert.equal(sha(fs.readFileSync(portrait.asset)),portrait.sha256,portrait.id+' image is byte-identical');checks.push(portrait.id+' exact original image bytes');}
 const result={status:'pass',checks,scope:'Exact source parity except stable avatar identities; exact JPEG bytes. Browser resolution and persistence require separate UI checks.'};fs.writeFileSync(root+'/source-identity.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:'pass',checks:checks.length}));
}
