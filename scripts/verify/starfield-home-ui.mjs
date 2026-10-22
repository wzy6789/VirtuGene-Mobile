import { chromium } from 'playwright';
import { starfieldPreview } from '../preview-starfield-upgrade.mjs';
import { mkdirSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out=process.env.VG_STARFIELD_HOME_OUTPUT||`.tmp-preview/starfield-upgrade-20261017/P2/checks/${Date.now()}`;
mkdirSync(out,{recursive:true});
const report={at:new Date().toISOString(),phase:'P2',checks:[],screenshots:[],errors:[],limitations:['Real components with isolated test records; not the user right-sidebar session.','Text enlargement uses root font size and verifies actual computed button sizing.','No Android/native claim.']};
let preview,browser;
async function check(name,run){try{report.checks.push({name,pass:true,detail:await run()});}catch(e){report.checks.push({name,pass:false,error:String(e)});if(process.argv.includes('--red'))throw e;}}
try{
  preview=await starfieldPreview({port:0,output:out+'/server'});browser=await chromium.launch({channel:'chrome'});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(preview.address+'/app?virtugene-preview=mobile');await page.waitForFunction(()=>window.starfieldReady);await page.getByRole('navigation',{name:'世界入口',exact:true}).waitFor();
  await check('homepage removes duplicate archives/settings',async()=>{assert.equal(await page.getByText('世界里的记录',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'世界设定',exact:true}).count(),0);});
  for(const theme of ['dark','light'])for(const width of [320,360,390,430]){
    await page.setViewportSize({width,height:844});await page.evaluate(theme=>window.starfieldPreview.theme(theme),theme);
    await page.evaluate(()=>window.starfieldPreview.setState('long-name'));await page.locator('.vg-world-assistant').waitFor();await page.evaluate(()=>document.fonts.ready);
    for(const scale of [1,1.25,1.5]){
      await page.evaluate(scale=>document.documentElement.style.fontSize=`${16*scale}px`,scale);
      await page.waitForFunction(scale=>parseFloat(getComputedStyle(document.querySelector('.vg-world-assistant button')).fontSize)===15*scale,scale);
      await check(`${theme}-${width}-${scale}: full labels and text enlargement`,async()=>{
        const data=await page.evaluate(()=>{
          const card=document.querySelector('.vg-world-assistant'),buttons=[...card.querySelectorAll('button')];
          const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
          const lines=n=>{const range=document.createRange();range.selectNodeContents(n);return[...range.getClientRects()].map(r=>({y:r.y,width:r.width,height:r.height}));};
          const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
          const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
          const panel=getComputedStyle(card),primary=getComputedStyle(buttons[0]),detail=card.querySelector('.vg-world-assistant-detail'),descriptionLines=[];
          for(let i=0;i<detail.textContent.length;i++){const range=document.createRange();range.setStart(detail.firstChild,i);range.setEnd(detail.firstChild,i+1);const y=Math.round(range.getBoundingClientRect().y),last=descriptionLines.at(-1);if(last?.y===y)last.text+=detail.textContent[i];else descriptionLines.push({y,text:detail.textContent[i]});}
          const worldStyle=getComputedStyle(document.querySelector('.vg-world-page'));
          return{viewport:innerWidth,scroll:document.documentElement.scrollWidth,worldBackground:worldStyle.backgroundColor,padding:parseFloat(worldStyle.paddingLeft),card:rect(card),buttons:buttons.map(n=>({label:n.textContent.trim(),font:parseFloat(getComputedStyle(n).fontSize),size:rect(n),scrollWidth:n.scrollWidth,lines:lines(n)})),title:rect(card.querySelector('h2')),titleText:card.querySelector('h2').textContent,description:rect(detail),descriptionLines,contrast:{title:contrast(panel.color,panel.backgroundColor),detail:contrast(getComputedStyle(detail).color,panel.backgroundColor),primary:contrast(primary.color,primary.backgroundColor)},bodyBg:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),meta:document.querySelector('meta[name="theme-color"]')?.content};
        });
        assert.deepEqual(data.buttons.map(b=>b.label),['聊一聊','助理空间']);assert.equal(data.buttons[0].font,15*scale);assert(data.buttons.every(b=>b.size.height>=48&&b.size.width>=44&&b.scrollWidth<=b.size.width+1));assert(data.buttons.every(b=>new Set(b.lines.map(r=>Math.round(r.y))).size===1));assert(data.scroll<=data.viewport);assert(data.title.x>=data.card.x);assert(data.title.x+data.title.width<=data.card.x+data.card.width+1);assert.equal(data.bodyBg,theme==='dark'?'#0b0e16':'#f4f3f8');assert.equal(data.meta,data.bodyBg);assert.equal(data.padding,width===320?16:20);assert.notEqual(data.worldBackground,'rgba(0, 0, 0, 0)');assert(Object.values(data.contrast).every(ratio=>ratio>=4.5));assert(!['下','下。'].includes(data.descriptionLines.at(-1).text));return data;
      });
      const file=`${theme}-${width}-${Math.round(scale*100)}.png`;await page.screenshot({path:out+'/'+file,fullPage:true});report.screenshots.push(file);
    }
    await page.evaluate(()=>document.documentElement.style.fontSize='16px');
    await page.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector('.vg-world-assistant button')).fontSize)===15);
    await check(`${theme}-${width}: actual assistant chat and today routes`,async()=>{
      await page.getByRole('button',{name:'聊一聊',exact:true}).click();await page.locator('.vg-assistant-hub').waitFor();assert.equal(await page.locator('.vg-assistant-tabs button[aria-current="page"]').innerText(),'对话');
      let firstModelChoice=false;
      try{await page.getByRole('button',{name:'返回世界',exact:true}).click({timeout:1000});}
      catch(error){const picker=page.getByRole('dialog',{name:'选择对话模型',exact:true});if(!await picker.isVisible())throw error;firstModelChoice=true;await picker.getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'返回世界',exact:true}).click();}
      await page.locator('.vg-world-assistant').waitFor();
      await page.getByRole('button',{name:'助理空间',exact:true}).click();await page.locator('.vg-assistant-hub').waitFor();assert.equal(await page.locator('.vg-assistant-tabs button[aria-current="page"]').innerText(),'今日');await page.getByRole('button',{name:'返回世界',exact:true}).click();await page.locator('.vg-world-assistant').waitFor();
      return{firstModelChoiceDismissed:firstModelChoice};
    });
    await check(`${theme}-${width}: archives remain in starfield`,async()=>{await page.getByRole('button',{name:'星域',exact:true}).click();const dock=page.getByRole('navigation',{name:'世界档案',exact:true});await dock.waitFor();for(const name of ['关系','记忆','年表','设定'])assert.equal(await dock.getByRole('button',{name:new RegExp('^'+name)}).count(),1);await page.getByRole('button',{name:'返回世界',exact:true}).click();await page.locator('.vg-world-assistant').waitFor();});
    await page.evaluate(()=>window.starfieldPreview.setState('empty'));await page.locator('.vg-world-assistant').waitFor();
    await check(`${theme}-${width}: unhired only offers real hire action`,async()=>{assert.equal(await page.locator('.vg-world-assistant button').count(),1);assert.equal(await page.getByRole('button',{name:'聘用生活助理',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'聊一聊',exact:true}).count(),0);});
    await check(`${theme}-${width}: no external attempts`,async()=>{const s=await page.evaluate(()=>window.starfieldPreview.snapshot());assert(Object.values(s.isolation).every(n=>n===0),JSON.stringify(s.isolation));return s.isolation;});
  }
  await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'角色',exact:true}).click();
  for(const theme of ['dark','light'])for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});await page.evaluate(theme=>window.starfieldPreview.theme(theme),theme);
    await page.getByRole('textbox',{name:'搜索角色',exact:true}).fill('P2-no-matching-role');
    const emptyButton=page.getByRole('button',{name:'清除筛选',exact:true});await emptyButton.waitFor();
    await page.waitForFunction(theme=>getComputedStyle(document.querySelector('.vg-empty-action > button')).backgroundColor===(theme==='dark'?'rgb(188, 168, 239)':'rgb(112, 80, 178)'),theme);
    await check(`${theme}-${width}: actual empty-state normal/pressed contrast`,async()=>{
      const read=()=>emptyButton.evaluate(button=>{const s=getComputedStyle(button);const l=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);const a=l(s.color),b=l(s.backgroundColor),r=button.getBoundingClientRect();return{ink:s.color,background:s.backgroundColor,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),width:r.width,height:r.height,active:button.matches(':active')};});
      const normal=await read();await emptyButton.scrollIntoViewIfNeeded();const box=await emptyButton.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(180);
      const pressed=await read();await page.screenshot({path:out+`/${theme}-${width}-empty-pressed.png`});await page.mouse.up();
      const data={normal,pressed};(report.emptyStates??=[]).push({theme,width,...data});assert(normal.contrast>=4.5&&pressed.contrast>=4.5,JSON.stringify(data));assert(pressed.active);assert(normal.height>=48&&normal.width>=44);return data;
    });
  }
}catch(error){report.errors.push(error.stack||String(error));}
finally{await browser?.close();if(preview)await new Promise(r=>preview.server.close(r));report.pass=report.errors.length===0&&report.checks.length===63&&report.checks.every(c=>c.pass);writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),errors:report.errors}));}
if(!report.pass)process.exitCode=1;
