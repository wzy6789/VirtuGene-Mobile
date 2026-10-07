const {createRequire}=require('node:module');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=createRequire(path.join(path.dirname(process.execPath),'package.json'))('playwright');
const output=path.resolve('.tmp-preview/orb-motion-601');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{
  const file=path.join(__dirname,path.basename((req.url||'/character-orb.html').split('?')[0]));
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const theme of ['dark','light']){
      const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'no-preference',recordVideo:{dir:output,size:{width:390,height:844}}});
      const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/character-orb.html?virtugene-preview=mobile`);
      await page.waitForFunction(()=>window.orbTest);await page.evaluate(()=>window.orbTest.chat());
      await page.getByRole('button',{name:'打开晓来的状态与互动'}).waitFor();
      if(theme==='light')await page.evaluate(()=>document.documentElement.classList.remove('dark'));
      await page.waitForTimeout(1400);
      const button=page.getByRole('button',{name:'打开晓来的状态与互动'}),box=await button.boundingBox();
      await page.mouse.move(box.x-45,box.y+box.height/2);await page.waitForTimeout(600);
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(240);
      await page.mouse.move(box.x-65,box.y+box.height/2);await page.mouse.up();await page.waitForTimeout(500);
      if(await page.getByRole('dialog').count())throw Error('Cancelled press opened a panel');
      await button.click();await page.locator('.vg-role-orb-summary').waitFor();
      await page.waitForTimeout(1400);
      await page.evaluate(()=>window.orbTest.snapshot(9,'orb-role','开心'));await page.waitForTimeout(900);
      await page.evaluate(()=>window.orbTest.snapshot(5,'orb-role','惊讶'));await page.waitForTimeout(900);
      await page.evaluate(()=>window.orbTest.snapshot(2,'orb-role','低落'));await page.waitForTimeout(1300);
      await page.screenshot({path:path.join(output,`panel-${theme}.png`)});
      await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(800);
      if(errors.length)throw Error(errors.join('\n'));
      const video=page.video();await context.close();await video.saveAs(path.join(output,`chat-panel-${theme}.webm`));await video.delete();
      console.log(`Recorded actual 44/52px ${theme} chat/panel motion, cancelled drag and quiet mode`);
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
