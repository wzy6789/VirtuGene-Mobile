import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out=process.env.VG_STYLE_REFLOW_OUT??'.tmp-preview/ui-overhaul-20261015/style-workspace/reflow';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:900,height:960}}),page=await context.newPage();
const report={checks:[],errors:[],screenshots:[],scope:'Forced 200% computed text size and line height in production workspace, desktop browser only. Not Android textZoom or OS accessibility certification.',modelCalls:0,microphoneCalls:0};
page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.goto(process.env.VG_STYLE_REFLOW_ADDRESS??'http://127.0.0.1:5290/');const app=page.frameLocator('iframe');await app.locator('body').evaluate(async()=>{while(!window.productUpgradeReady)await new Promise(requestAnimationFrame);await productUpgradeTest.go('style');});
 const editor=app.getByRole('dialog',{name:'角色造型间',exact:true});await editor.waitFor();
 for(const width of [320,390])for(const theme of ['dark','light']){
  await page.locator('iframe').evaluate((n,width)=>n.style.width=`${width}px`,width);await app.locator('body').evaluate((n,theme)=>productUpgradeTest.theme(theme),theme);
  const metrics=await editor.evaluate(root=>{
   const nodes=[...root.querySelectorAll('button,strong,p,small,summary,label,span,input,textarea,h2,h3')].filter(n=>n.matches('input,textarea')||[...n.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim()));
   const snapshots=nodes.map(node=>({node,style:node.getAttribute('style'),font:parseFloat(getComputedStyle(node).fontSize),line:parseFloat(getComputedStyle(node).lineHeight)}));
   window.restoreStyleText=()=>snapshots.forEach(({node,style})=>style===null?node.removeAttribute('style'):node.setAttribute('style',style));
   snapshots.forEach(({node,font,line})=>{node.style.fontSize=`${font*2}px`;if(Number.isFinite(line))node.style.lineHeight=`${line*2}px`;});
   return{count:snapshots.length};
  });
  for(const section of ['素材','色彩','背景','小球']){
   await editor.getByRole('button',{name:section,exact:true}).click();await editor.locator('[data-modal-scroll]').evaluate(n=>n.scrollTop=0);
   const overflow=await editor.evaluate(root=>({root:root.scrollWidth-root.clientWidth,nodes:[...root.querySelectorAll('button,label,summary,h2,h3,p')].filter(n=>n.getClientRects().length&&!n.closest('[hidden]')&&n.scrollWidth>n.clientWidth+2).map(n=>({text:n.textContent.slice(0,45),over:n.scrollWidth-n.clientWidth}))}));
   await page.locator('iframe').screenshot({path:`${out}/${section}-${theme}-${width}.png`});report.screenshots.push(`${out}/${section}-${theme}-${width}.png`);
   assert.ok(overflow.root<=1&&overflow.nodes.length===0,JSON.stringify({width,theme,section,overflow}));report.checks.push(`${width}/${theme}/${section}: 200% text without horizontal overflow (${metrics.count} text nodes)`);
   assert.ok(await editor.getByRole('button',{name:'保存外观',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect();return r.height>=44&&r.width>=44&&r.bottom<=innerHeight+1;}));
   assert.ok(await editor.locator('.vg-modal-footer button').evaluateAll(nodes=>nodes.every(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getClientRects().length===1;})),'fixed footer labels stay on one line at 200%');
  }
  await editor.evaluate(()=>restoreStyleText());
 }
 assert.equal(report.errors.length,0);report.status='pass';
}catch(error){report.status='failed';report.failure=error.stack;throw error;}finally{await browser.close();writeFileSync(`${out}/result.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure}));}
