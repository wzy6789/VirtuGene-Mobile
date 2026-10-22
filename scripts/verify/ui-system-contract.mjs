import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { uiSystemPreview } from '../preview-ui-system.mjs';

const out=resolve(process.env.VG_UI_SYSTEM_OUTPUT??'.tmp-preview/ui-overhaul-20261015/ui-system');
mkdirSync(out,{recursive:true});
const preview=await uiSystemPreview({port:0,watch:false});
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],screenshots=[],axe=[],consoleErrors=[];
const check=(name,pass,details)=>{results.push({name,pass:!!pass,...(details===undefined?{}:{details})});if(!pass)throw Error(name);};
const evidence=await (await fetch(`${preview.address}/preview-manifest.json`)).json();
let failure;
try {
  for(const mode of ['dark','light'])for(const width of [320,390,430,1280]){
    const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1,reducedMotion:'no-preference'});
    const page=await context.newPage();
    page.on('pageerror',error=>consoleErrors.push({mode,width,error:error.message}));
    await page.goto(`${preview.address}/?theme=${mode}`);
    await page.waitForFunction(()=>!!window.uiSystemContract);
    const layout=await page.evaluate(()=>({theme:window.uiSystemContract.inspect().theme,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,sections:document.querySelectorAll('main>section').length,contracts:window.uiSystemContract.contracts.length,tiny:[...document.querySelectorAll('button')].filter(node=>{const r=node.getBoundingClientRect();return r.width&&r.height&&r.height<44}).map(node=>({label:node.textContent,height:node.getBoundingClientRect().height}))}));
    check(`${mode}/${width}: actual theme, 6 sections and 3 contracts`,layout.theme===mode&&layout.sections===6&&layout.contracts===3,layout);
    check(`${mode}/${width}: no horizontal overflow`,layout.scrollWidth<=width,layout);
    check(`${mode}/${width}: button targets at least 44px`,!layout.tiny.length,layout.tiny);
    if(width===390||width===1280){const path=join(out,`${mode}-${width}.png`);await page.screenshot({path,fullPage:true});screenshots.push(path);}
    if(width===390){
      const input=page.getByLabel('聊天草稿');
      await input.fill('验收草稿：失败后仍然保留。');
      await page.getByRole('button',{name:'模拟保存失败',exact:true}).click();
      await page.getByText('示例保存失败，输入内容已保留。',{exact:true}).waitFor();
      check(`${mode}: failed operation preserves draft`,await input.inputValue()==='验收草稿：失败后仍然保留。');
      await page.getByRole('button',{name:'重试',exact:true}).click();
      await page.getByText('示例保存成功，草稿仍保留在此页面。',{exact:true}).waitFor();
      check(`${mode}: local retry succeeds without replacing draft`,await input.inputValue()==='验收草稿：失败后仍然保留。');
      const toggle=page.getByRole('switch',{name:'氛围效果',exact:true});await toggle.click();
      check(`${mode}: production switch state changes`,await toggle.getAttribute('aria-checked')==='false');
      const choice=page.getByRole('radio',{name:'生动 更明显的角色氛围'});await choice.check();
      check(`${mode}: production choices respond`,await choice.isChecked());
      await page.getByRole('button',{name:'聚焦输入框',exact:true}).click();
      check(`${mode}: text field receives visible focus`,await input.evaluate(node=>node===document.activeElement&&node.matches(':focus-visible')));
      const fieldFocus=join(out,`${mode}-input-focus.png`);await page.locator('#forms').screenshot({path:fieldFocus});screenshots.push(fieldFocus);
      const press=page.getByRole('button',{name:'按住体验',exact:true});await press.scrollIntoViewIfNeeded();const box=await press.boundingBox();
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
      check(`${mode}: production press feedback activates`,await press.getAttribute('data-pressed')!==null);
      const pressPath=join(out,`${mode}-pressed.png`);await page.locator('#controls').screenshot({path:pressPath});screenshots.push(pressPath);
      await page.mouse.move(box.x+box.width+40,box.y+box.height+30);await page.mouse.up();
      check(`${mode}: slide-out cancels pressed feedback`,await press.getAttribute('data-pressed')===null);
      const open=page.getByRole('button',{name:'打开居中弹窗',exact:true});await open.click();
      await page.getByRole('dialog',{name:'居中弹窗示例'}).waitFor();
      check(`${mode}: centered dialog uses production component`,await page.locator('.vg-mobile-dialog').count()===1);
      await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
      check(`${mode}: escape restores trigger focus`,await open.evaluate(node=>document.activeElement===node));
      await page.getByRole('button',{name:'打开详情页',exact:true}).click();await page.getByRole('dialog',{name:'详情页示例'}).waitFor();
      check(`${mode}: long form has fixed footer`,await page.locator('.vg-mobile-page .vg-modal-footer button').count()===2);
      await page.locator('.vg-modal-overlay').evaluate(node=>Promise.all(node.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation=>animation.finished.catch(()=>undefined))));
      const modalPath=join(out,`${mode}-detail.png`);await page.screenshot({path:modalPath});screenshots.push(modalPath);
      await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
      await page.evaluate(()=>window.uiSystemContract.reduced(true));
      check(`${mode}: reduced motion preference applies`,await page.evaluate(()=>window.uiSystemContract.inspect().reduced==='true'));
      check(`${mode}: all signature contracts identify fallback and interruptions`,await page.evaluate(()=>window.uiSystemContract.contracts.every(contract=>contract.interruption&&contract.downgrade&&contract.phases.length===3)));
      const storyPath=join(out,`${mode}-storyboards.png`);await page.locator('#motion').screenshot({path:storyPath});screenshots.push(storyPath);
      const accessibility=await new AxeBuilder({page}).analyze();
      axe.push({mode,width,violations:accessibility.violations,incomplete:accessibility.incomplete});
      check(`${mode}: no axe violations`,accessibility.violations.length===0,accessibility.violations.map(issue=>({id:issue.id,nodes:issue.nodes.map(node=>node.target)})));
      const isolation=await page.evaluate(()=>window.uiContractIsolation);
      check(`${mode}: no model/media/native calls attempted`,Object.values(isolation).every(count=>count===0),isolation);
    }
    await context.close();
  }
  check('No runtime errors in any viewport',consoleErrors.length===0,consoleErrors);
  const changed=evidence.css.filter(file=>{try{return createHash('sha256').update(readFileSync(resolve(file.path))).digest('hex')!==file.sha256;}catch{return true;}});
  check('Renderer CSS unchanged during verification',changed.length===0,changed);
} catch(error){failure=String(error.stack||error);}
finally{
  writeFileSync(join(out,'result.json'),JSON.stringify({generatedAt:new Date().toISOString(),passed:!failure,checks:results,evidence,screenshots,axe,consoleErrors,failure,limitations:['Desktop Chrome only; no Android verification.','Three signature storyboards are design contracts, not proof of completed production transition paths.','Actual source and built CSS hashes recorded separately.']},null,2));
  await browser.close();await preview.close();
}
console.log(JSON.stringify({passed:!failure,checks:results.length,failures:results.filter(check=>!check.pass).map(check=>check.name),evidence:join(out,'result.json')}));
if(failure){console.error(failure);process.exitCode=1;}
