import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const out='.tmp-preview/stage2-ui-20261018/S10-C/create-reflow';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={checks:[],cases:[],errors:[],scope:'Actual creation component, synthetic local account; computed text doubled, not Android IME/textZoom.',modelCalls:0};
try {
  for(const theme of ['dark','light']) for(const height of [844,540]) {
    const context=await browser.newContext({viewport:{width:320,height},reducedMotion:'reduce'});
    const page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(`http://127.0.0.1:5302/app?virtugene-preview=mobile&theme=${theme}`);
    await page.waitForFunction(()=>window.productUpgradeReady);
    await page.evaluate(()=>productUpgradeTest.go('create'));
    await page.getByRole('button',{name:'创造基因',exact:true}).click();
    const name=page.getByPlaceholder('为数字灵魂命名');
    await name.fill('长风与星河');
    const dialog=page.getByRole('dialog',{name:'创建角色',exact:true});
    const font=await dialog.evaluate(root=>{
      const nodes=[...root.querySelectorAll('*')].filter(n=>n instanceof HTMLElement&&(n.matches('input,textarea')||[...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim())));
      const sizes=nodes.map(n=>({n,font:parseFloat(getComputedStyle(n).fontSize),line:parseFloat(getComputedStyle(n).lineHeight)}));
      sizes.forEach(({n,font,line})=>{n.style.fontSize=`${font*2}px`;if(Number.isFinite(line))n.style.lineHeight=`${line*2}px`;});
      return {nodes:nodes.length,fieldFont:getComputedStyle(root.querySelector('input')).fontSize};
    });
    for(const step of ['identity','personality']) {
      const metrics=await dialog.evaluate(root=>({width:root.clientWidth,overflow:root.scrollWidth-root.clientWidth,footer:[...root.querySelectorAll('.vg-modal-footer button')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return {text:n.textContent.trim(),x:r.x,right:r.right,bottom:r.bottom,w:r.width,h:r.height};})}));
      report.cases.push({theme,height,step,font,metrics});
      await page.screenshot({path:`${out}/${step}-${theme}-320-${height}-font200.png`});
      assert.ok(metrics.overflow<=1,JSON.stringify({theme,height,step,metrics}));
      assert.ok(metrics.footer.length>0);
      assert.ok(metrics.footer.every(r=>r.w>=44&&r.h>=44&&r.x>=0&&r.right<=321&&r.bottom<=height+1),JSON.stringify(metrics.footer));
      report.checks.push(`${theme}/320x${height}/${step}: no horizontal overflow, footer reachable at 200% text`);
      if(step==='identity') await page.getByRole('button',{name:'下一步',exact:true}).click();
    }
    assert.ok(Object.values(await page.evaluate(()=>window.previewIsolation)).every(n=>n===0));
    await context.close();
  }
  assert.deepEqual(report.errors,[]);report.status='pass';
} catch(error) {report.status='failed';report.failure=error.stack;throw error;}
finally {await browser.close();writeFileSync(`${out}/result.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure}));}
